import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Headers,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../../../../common/guards/api-key-auth.guard';
import { DocumentService } from './document.service';
import { DocumentReadRequestDto, DocumentReadResponseDto } from './dto/document-read.dto';
import {
  ReplaceDocumentRequestDto,
  ReplaceDocumentResponseDto,
  InsertContentRequestDto,
  InsertContentResponseDto,
  ReplaceRangeRequestDto,
  ReplaceRangeResponseDto,
} from './dto/document-write.dto';
import { WorkspaceService } from '../../../../core/workspace/services/workspace.service';
import { UserService } from '../../../../core/user/user.service';
import { Workspace } from '@docmost/db/types/entity.types';

/**
 * Internal API Controller for AI Service
 * 
 * This controller provides endpoints that the AI service can call back to.
 * Uses API key authentication instead of JWT (service-to-service communication).
 * 
 * Endpoint: /api/internal/ai/document/*
 * Authentication: X-API-Key header (from EXTERNAL_SERVICE_API_KEY env var)
 * Context: X-Workspace-Id and X-User-Id headers (provided by AI service)
 */
@UseGuards(ApiKeyAuthGuard)
@Controller('internal/ai/document')
export class DocumentInternalController {
  private readonly logger = new Logger(DocumentInternalController.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly userService: UserService,
  ) {}

  /**
   * Internal endpoint for AI service to read documents
   * POST /api/internal/ai/document/read
   * 
   * Authentication: API Key (X-API-Key header)
   * Context: Workspace ID and User ID from headers
   * 
   * This allows the AI service to call back to the backend to read documents
   * without requiring JWT authentication.
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  async readDocument(
    @Body() dto: DocumentReadRequestDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<DocumentReadResponseDto> {
    if (!workspaceId || !userId) {
      this.logger.warn(
        `Missing required headers: workspaceId=${!!workspaceId}, userId=${!!userId}`,
      );
      throw new ForbiddenException(
        'X-Workspace-Id and X-User-Id headers are required',
      );
    }

    // Validate workspace exists
    let workspace: Workspace;
    try {
      workspace = await this.workspaceService.getWorkspaceInfo(workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.warn(`Workspace not found: ${workspaceId}`);
        throw new NotFoundException('Workspace not found');
      }
      throw error;
    }

    // Validate user exists in workspace
    try {
      const user = await this.userService.findById(userId, workspaceId);
      if (!user) {
        this.logger.warn(`User not found: ${userId} in workspace ${workspaceId}`);
        throw new NotFoundException('User not found');
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error validating user: ${error}`);
      throw new ForbiddenException('Invalid user or workspace');
    }

    this.logger.log(
      `AI service reading document ${dto.pageId} (workspace: ${workspaceId}, user: ${userId})`,
    );

    // Use DocumentService which handles permissions and validation
    // Note: We pass the workspace and userId, but DocumentService will still
    // validate that the page belongs to the workspace
    return this.documentService.readDocument(dto, workspace, userId);
  }

  /**
   * Helper to validate workspace and user
   */
  private async validateWorkspaceAndUser(
    workspaceId: string,
    userId: string,
  ): Promise<Workspace> {
    if (!workspaceId || !userId) {
      this.logger.warn(
        `Missing required headers: workspaceId=${!!workspaceId}, userId=${!!userId}`,
      );
      throw new ForbiddenException(
        'X-Workspace-Id and X-User-Id headers are required',
      );
    }

    // Validate workspace exists
    let workspace: Workspace;
    try {
      workspace = await this.workspaceService.getWorkspaceInfo(workspaceId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.warn(`Workspace not found: ${workspaceId}`);
        throw new NotFoundException('Workspace not found');
      }
      throw error;
    }

    // Validate user exists in workspace
    try {
      const user = await this.userService.findById(userId, workspaceId);
      if (!user) {
        this.logger.warn(`User not found: ${userId} in workspace ${workspaceId}`);
        throw new NotFoundException('User not found');
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error validating user: ${error}`);
      throw new ForbiddenException('Invalid user or workspace');
    }

    return workspace;
  }

  /**
   * Internal endpoint for AI service to replace document content
   * POST /api/internal/ai/document/replace
   */
  @Post('replace')
  @HttpCode(HttpStatus.OK)
  async replaceDocument(
    @Body() dto: ReplaceDocumentRequestDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<ReplaceDocumentResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);

    this.logger.log(
      `AI service replacing document ${dto.pageId} (workspace: ${workspaceId}, user: ${userId})`,
    );

    return this.documentService.replaceDocument(dto, workspace, userId);
  }

  /**
   * Internal endpoint for AI service to insert content
   * POST /api/internal/ai/document/insert
   */
  @Post('insert')
  @HttpCode(HttpStatus.OK)
  async insertContent(
    @Body() dto: InsertContentRequestDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<InsertContentResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);

    this.logger.log(
      `AI service inserting content into document ${dto.pageId} (workspace: ${workspaceId}, user: ${userId}, position: ${dto.position || 'end'})`,
    );

    return this.documentService.insertContent(dto, workspace, userId);
  }

  /**
   * Internal endpoint for AI service to replace content range
   * POST /api/internal/ai/document/replace-range
   */
  @Post('replace-range')
  @HttpCode(HttpStatus.OK)
  async replaceRange(
    @Body() dto: ReplaceRangeRequestDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<ReplaceRangeResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);

    this.logger.log(
      `AI service replacing range in document ${dto.pageId} (workspace: ${workspaceId}, user: ${userId}, from: ${dto.from}, to: ${dto.to})`,
    );

    return this.documentService.replaceRange(dto, workspace, userId);
  }
}

