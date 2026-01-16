import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { EnvironmentService } from '../environment/environment.service';
import { CallExternalServiceDto, ExternalServiceResponseDto } from './dto/call-external-service.dto';
import { Workspace } from '@docmost/db/types/entity.types';

@Injectable()
export class ExternalServiceService {
  private readonly logger = new Logger(ExternalServiceService.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(private readonly environmentService: EnvironmentService) {
    this.baseUrl =
      process.env.EXTERNAL_SERVICE_URL ||
      this.environmentService.getExternalServiceUrl();
    this.apiKey =
      process.env.EXTERNAL_SERVICE_API_KEY ||
      this.environmentService.getExternalServiceApiKey();
    this.timeout =
      parseInt(
        process.env.EXTERNAL_SERVICE_TIMEOUT ||
          this.environmentService.getExternalServiceTimeout(),
        10,
      ) || 30000;

    this.logger.log(
      `External Service configured: ${this.baseUrl} (timeout: ${this.timeout}ms)`,
    );
  }

  /**
   * Call external service with workspace context
   */
  async callExternalService(
    dto: CallExternalServiceDto,
    workspace: Workspace,
    userId: string,
  ): Promise<ExternalServiceResponseDto> {
    try {
      // Validate endpoint
      if (!dto.endpoint) {
        throw new BadRequestException('Endpoint is required');
      }

      // Build full URL
      const url = this.buildUrl(dto.endpoint, dto.query);

      // Prepare headers with authentication and workspace context
      const headers = this.prepareHeaders(dto.headers, workspace, userId);

      // Prepare request options
      const requestOptions: RequestInit = {
        method: dto.method,
        headers,
        signal: AbortSignal.timeout(this.timeout),
      };

      // Add body for methods that support it
      if (dto.body && ['POST', 'PUT', 'PATCH'].includes(dto.method)) {
        requestOptions.body = JSON.stringify(dto.body);
      }

      this.logger.debug(
        `Calling external service: ${dto.method} ${url} (workspace: ${workspace.id})`,
      );

      // Make the request
      const response = await fetch(url, requestOptions);

      // Parse response
      const responseData = await this.parseResponse(response);

      // Log response
      this.logger.debug(
        `External service response: ${response.status} for ${url}`,
      );

      return {
        status: response.status,
        data: responseData,
        headers: this.extractResponseHeaders(response),
      };
    } catch (error) {
      this.handleError(error, dto.endpoint);
    }
  }

  /**
   * Build full URL from endpoint and query parameters
   */
  private buildUrl(endpoint: string, query?: Record<string, string>): string {
    // Remove leading slash if present
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const baseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    let url = `${baseUrl}/${cleanEndpoint}`;

    // Add query parameters
    if (query && Object.keys(query).length > 0) {
      const queryString = new URLSearchParams(query).toString();
      url += `?${queryString}`;
    }

    return url;
  }

  /**
   * Prepare headers with authentication and workspace context
   */
  private prepareHeaders(
    customHeaders?: Record<string, string>,
    workspace?: Workspace,
    userId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Docmost-External-Service-Client/1.0',
      ...customHeaders,
    };

    // Add API key if available (use X-API-Key header for AI service)
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    // Add workspace context headers
    if (workspace) {
      headers['X-Workspace-Id'] = workspace.id;
      headers['X-Workspace-Name'] = workspace.name;
    }

    if (userId) {
      headers['X-User-Id'] = userId;
    }

    return headers;
  }

  /**
   * Parse response based on content type
   */
  private async parseResponse(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch (error) {
        this.logger.warn('Failed to parse JSON response', error);
        return null;
      }
    }

    if (contentType.includes('text/')) {
      return await response.text();
    }

    // For binary or other types, return as array buffer
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Extract response headers
   */
  private extractResponseHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  /**
   * Handle errors with appropriate exceptions
   */
  private handleError(error: any, endpoint: string): never {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      this.logger.error(`External service timeout: ${endpoint}`, error);
      throw new GatewayTimeoutException(
        `External service request timed out after ${this.timeout}ms`,
      );
    }

    if (error instanceof BadRequestException) {
      throw error;
    }

    if (error instanceof ServiceUnavailableException) {
      throw error;
    }

    // Network errors
    if (error.message?.includes('fetch failed') || error.code === 'ECONNREFUSED') {
      this.logger.error(`External service connection failed: ${endpoint}`, error);
      throw new ServiceUnavailableException(
        'External service is currently unavailable',
      );
    }

    // Generic error
    this.logger.error(`External service error: ${endpoint}`, error);
    throw new ServiceUnavailableException(
      `Failed to communicate with external service: ${error.message}`,
    );
  }

  /**
   * Health check for external service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/health`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      this.logger.warn('External service health check failed', error);
      return false;
    }
  }
}

