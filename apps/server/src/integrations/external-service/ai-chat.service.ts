import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { EnvironmentService } from '../environment/environment.service';
import { AiChatRequestDto, AiChatResponseDto } from './dto/ai-chat.dto';
import { AiTextTransformRequestDto, AiTextTransformResponseDto } from './dto/ai-text-transform.dto';
import { Workspace } from '@docmost/db/types/entity.types';

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(
    private readonly environmentService: EnvironmentService,
  ) {
    this.baseUrl =
      process.env.EXTERNAL_SERVICE_URL ||
      this.environmentService.getExternalServiceUrl() ||
      'http://localhost:8000';
    this.apiKey =
      process.env.EXTERNAL_SERVICE_API_KEY ||
      this.environmentService.getExternalServiceApiKey() ||
      'parth128';
    this.timeout =
      parseInt(
        process.env.EXTERNAL_SERVICE_TIMEOUT ||
          this.environmentService.getExternalServiceTimeout() ||
          '240000', // 4 minutes default (240 seconds = 240000ms)
        10,
      ) || 240000; // 4 minutes default

    this.logger.log(
      `AI Chat Service configured: ${this.baseUrl} (timeout: ${this.timeout}ms)`,
    );
  }

  /**
   * Stream chat message from AI service (SSE)
   * Returns an async generator that yields SSE events
   */
  async* streamChatMessage(
    request: AiChatRequestDto,
    workspace: Workspace,
    userId: string,
  ): AsyncGenerator<string, void, unknown> {
    try {
      const url = `${this.baseUrl}/api/chat/stream`;

      // Prepare headers with authentication
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      // Add page ID to headers if provided
      if (request.pageId) {
        headers['X-Page-Id'] = request.pageId;
      }

      // Prepare request body
      const requestBody: any = {
        messages: request.messages,
      };

      // Include pageId in request body if provided
      if (request.pageId) {
        requestBody.pageId = request.pageId;
      }

      // Prepare request
      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      };

      this.logger.log(
        `Streaming AI chat (workspace: ${workspace.id}, user: ${userId}, messages: ${request.messages.length}, pageId: ${request.pageId || 'none'})`,
      );

      // Make the request
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `AI service streaming error: ${response.status} - ${errorText}`,
        );
        throw new ServiceUnavailableException(
          `AI service returned error: ${response.statusText}`,
        );
      }

      // Stream the response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new ServiceUnavailableException('Response body is not readable');
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          
          // Yield the chunk directly (already formatted as SSE)
          yield chunk;
        }
      } finally {
        reader.releaseLock();
      }

      this.logger.debug(
        `AI chat stream completed (workspace: ${workspace.id})`,
      );
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        this.logger.error(`AI service stream timeout after ${this.timeout}ms`);
        // Yield error event
        yield `event: error\ndata: ${JSON.stringify({ error: 'Request timeout' })}\n\n`;
      } else if (error instanceof ServiceUnavailableException) {
        yield `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
      } else {
        this.logger.error('AI chat stream error', error);
        yield `event: error\ndata: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`;
      }
    }
  }

  /**
   * Send chat message to AI service
   * Headers include workspace ID, user ID, and page ID for context
   * AI service can use tools (like read_document) to fetch content when needed
   */
  async sendChatMessage(
    request: AiChatRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<AiChatResponseDto> {
    try {
      const url = `${this.baseUrl}/api/chat`;

      // Prepare headers with authentication
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      // Add page ID to headers if provided
      if (request.pageId) {
        headers['X-Page-Id'] = request.pageId;
      }

      // Prepare request body
      const requestBody: any = {
        messages: request.messages,
      };

      // Include pageId in request body if provided
      if (request.pageId) {
        requestBody.pageId = request.pageId;
      }

      // Prepare request
      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      };

      this.logger.log(
        `Sending AI chat request (workspace: ${workspace.id}, user: ${userId}, messages: ${request.messages.length}, pageId: ${request.pageId || 'none'})`,
      );

      // Make the request
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `AI service error: ${response.status} - ${errorText}`,
        );
        throw new ServiceUnavailableException(
          `AI service returned error: ${response.statusText}`,
        );
      }

      // Parse response
      const data = await response.json();

      this.logger.debug(
        `AI chat response received (workspace: ${workspace.id})`,
      );

      return {
        message: data.message || undefined, // Can be undefined if only toolCalls are present
        success: data.success !== false,
        toolCalls: data.toolCalls || undefined, // Forward toolCalls from AI service
      };
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        this.logger.error(`AI service timeout after ${this.timeout}ms`);
        throw new GatewayTimeoutException(
          `AI service request timed out after ${this.timeout}ms`,
        );
      }

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      // Network errors
      if (
        error?.message?.includes('fetch failed') ||
        error?.code === 'ECONNREFUSED'
      ) {
        this.logger.error('AI service connection failed', error);
        throw new ServiceUnavailableException(
          'AI service is currently unavailable',
        );
      }

      // Generic error
      this.logger.error('AI chat error', error);
      throw new ServiceUnavailableException(
        `Failed to communicate with AI service: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * Get chat history list
   */
  async getChatHistory(workspace: Workspace, userId: string): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/history`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new ServiceUnavailableException('Failed to fetch chat history');
      }

      return await response.json();
    } catch (error: any) {
      this.logger.error('Error fetching chat history', error);
      throw new ServiceUnavailableException('Failed to fetch chat history');
    }
  }

  /**
   * Get a specific chat
   */
  async getChat(
    chatId: string,
    workspace: Workspace,
    userId: string,
  ): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/history/${chatId}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new ServiceUnavailableException('Chat not found');
        }
        throw new ServiceUnavailableException('Failed to fetch chat');
      }

      return await response.json();
    } catch (error: any) {
      this.logger.error('Error fetching chat', error);
      throw new ServiceUnavailableException('Failed to fetch chat');
    }
  }

  /**
   * Delete a chat
   */
  async deleteChat(
    chatId: string,
    workspace: Workspace,
    userId: string,
  ): Promise<any> {
    try {
      const url = `${this.baseUrl}/api/history/${chatId}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new ServiceUnavailableException('Chat not found');
        }
        throw new ServiceUnavailableException('Failed to delete chat');
      }

      return await response.json();
    } catch (error: any) {
      this.logger.error('Error deleting chat', error);
      throw new ServiceUnavailableException('Failed to delete chat');
    }
  }

  /**
   * Send text transformation request to AI service
   * Used for improve, fix-grammar, change-tone commands
   */
  async transformText(
    request: AiTextTransformRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<AiTextTransformResponseDto> {
    try {
      const url = `${this.baseUrl}/api/text-transform`;

      // Prepare headers with authentication
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Workspace-Id': workspace.id,
        'X-User-Id': userId,
      };

      // Prepare request body
      const requestBody = {
        command: request.command,
        blockTextWithBrackets: request.blockTextWithBrackets,
        selectedText: request.selectedText,
        options: request.options,
      };

      // Prepare request
      const requestOptions: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout),
      };

      this.logger.log(
        `Sending AI text transform request (workspace: ${workspace.id}, user: ${userId}, command: ${request.command})`,
      );

      // Make the request
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `AI text transform error: ${response.status} - ${errorText}`,
        );
        throw new ServiceUnavailableException(
          `AI service returned error: ${response.statusText}`,
        );
      }

      // Parse response
      const data = await response.json();

      this.logger.debug(
        `AI text transform response received (workspace: ${workspace.id})`,
      );

      return {
        success: data.success !== false,
        transformedBlockText: data.transformedBlockText,
        modifiedText: data.modifiedText,
        error: data.error,
      };
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        this.logger.error(`AI text transform timeout after ${this.timeout}ms`);
        throw new GatewayTimeoutException(
          `AI service request timed out after ${this.timeout}ms`,
        );
      }

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      // Network errors
      if (
        error?.message?.includes('fetch failed') ||
        error?.code === 'ECONNREFUSED'
      ) {
        this.logger.error('AI service connection failed', error);
        throw new ServiceUnavailableException(
          'AI service is currently unavailable',
        );
      }

      // Generic error
      this.logger.error('AI text transform error', error);
      throw new ServiceUnavailableException(
        `Failed to communicate with AI service: ${error?.message || 'Unknown error'}`,
      );
    }
  }
}

