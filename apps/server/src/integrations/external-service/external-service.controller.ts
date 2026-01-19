import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Delete,
  Param,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ExternalServiceService } from './external-service.service';
import { AiChatService } from './ai-chat.service';
import { RateLimiterService } from './rate-limiter.service';
import { CallExternalServiceDto, ExternalServiceResponseDto } from './dto/call-external-service.dto';
import { AiChatRequestDto, AiChatResponseDto } from './dto/ai-chat.dto';
import { AiTextTransformRequestDto, AiTextTransformResponseDto } from './dto/ai-text-transform.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';

@UseGuards(JwtAuthGuard)
@Controller('external-service')
export class ExternalServiceController {
  private readonly logger = new Logger(ExternalServiceController.name);

  constructor(
    private readonly externalServiceService: ExternalServiceService,
    private readonly aiChatService: AiChatService,
    private readonly rateLimiterService: RateLimiterService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  /**
   * Call external service endpoint
   * Requires workspace edit permission
   */
  @HttpCode(HttpStatus.OK)
  @Post('call')
  async callExternalService(
    @Body() dto: CallExternalServiceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<ExternalServiceResponseDto> {
    // Check workspace permissions
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Edit, WorkspaceCaslSubject.Settings)) {
      this.logger.warn(
        `User ${user.id} attempted to call external service without permission`,
      );
      throw new ForbiddenException('Insufficient permissions to call external service');
    }

    this.logger.log(
      `User ${user.id} calling external service: ${dto.method} ${dto.endpoint} (workspace: ${workspace.id})`,
    );

    return this.externalServiceService.callExternalService(dto, workspace, user.id);
  }

  /**
   * Health check for external service
   * Requires workspace read permission
   */
  @HttpCode(HttpStatus.OK)
  @Post('health')
  async healthCheck(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<{ healthy: boolean; service: string }> {
    // Check workspace permissions
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const healthy = await this.externalServiceService.healthCheck();

    return {
      healthy,
      service: 'external-service',
    };
  }

  /**
   * AI Chat endpoint
   * Requires workspace edit permission
   * Rate limited: 30 requests per minute per user/workspace
   */
  @HttpCode(HttpStatus.OK)
  @Post('ai/chat')
  async aiChat(
    @Body() dto: AiChatRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<AiChatResponseDto> {
    // Check workspace permissions
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Edit, WorkspaceCaslSubject.Settings)) {
      this.logger.warn(
        `User ${user.id} attempted to use AI chat without permission (workspace: ${workspace.id})`,
      );
      throw new ForbiddenException('Insufficient permissions to use AI chat');
    }

    // Validate messages
    if (!dto.messages || dto.messages.length === 0) {
      throw new ForbiddenException('At least one message is required');
    }

    // Validate last message is from user
    const lastMessage = dto.messages[dto.messages.length - 1];
    if (lastMessage.role !== 'user') {
      throw new ForbiddenException('Last message must be from user');
    }

    // Check rate limit (30 requests per minute)
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} using AI chat (workspace: ${workspace.id}, message count: ${dto.messages.length})`,
    );

    return this.aiChatService.sendChatMessage(dto, workspace, user.id);
  }

  /**
   * Get chat history list
   * Requires workspace read permission
   */
  @HttpCode(HttpStatus.OK)
  @Get('ai/history')
  async getChatHistory(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<any> {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return this.aiChatService.getChatHistory(workspace, user.id);
  }

  /**
   * Get a specific chat
   * Requires workspace read permission
   */
  @HttpCode(HttpStatus.OK)
  @Get('ai/history/:chatId')
  async getChat(
    @Param('chatId') chatId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<any> {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return this.aiChatService.getChat(chatId, workspace, user.id);
  }

  /**
   * Delete a chat
   * Requires workspace edit permission
   */
  @HttpCode(HttpStatus.OK)
  @Delete('ai/history/:chatId')
  async deleteChat(
    @Param('chatId') chatId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<any> {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Edit, WorkspaceCaslSubject.Settings)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return this.aiChatService.deleteChat(chatId, workspace, user.id);
  }

  /**
   * AI Text Transform endpoint
   * Used for improve, fix-grammar, change-tone commands
   * Requires workspace edit permission
   * Rate limited: 30 requests per minute per user/workspace
   */
  @HttpCode(HttpStatus.OK)
  @Post('ai/text-transform')
  async aiTextTransform(
    @Body() dto: AiTextTransformRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<AiTextTransformResponseDto> {
    // Check workspace permissions
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Edit, WorkspaceCaslSubject.Settings)) {
      this.logger.warn(
        `User ${user.id} attempted to use AI text transform without permission (workspace: ${workspace.id})`,
      );
      throw new ForbiddenException('Insufficient permissions to use AI text transform');
    }

    // Validate request
    if (!dto.command) {
      throw new ForbiddenException('Command is required');
    }

    if (!dto.blockTextWithBrackets || !dto.selectedText) {
      throw new ForbiddenException('Block text and selected text are required');
    }

    // Check rate limit (30 requests per minute)
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} using AI text transform (workspace: ${workspace.id}, command: ${dto.command})`,
    );

    return this.aiChatService.transformText(dto, workspace, user.id);
  }
}

