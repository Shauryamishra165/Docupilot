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
import { WorkspaceInternalService } from './workspace-internal.service';
import { WorkspaceService } from '../../../../core/workspace/services/workspace.service';
import { UserService } from '../../../../core/user/user.service';
import { Workspace } from '@docmost/db/types/entity.types';
import {
  ListWorkspacePagesDto,
  ListWorkspacePagesResponseDto,
  GetPageStructureDto,
  GetPageStructureResponseDto,
  GetPageMetadataDto,
  GetPageMetadataResponseDto,
  SearchWorkspaceDto,
  SearchWorkspaceResponseDto,
} from './dto/workspace-api.dto';

/**
 * Internal API Controller for AI Service - Workspace Operations
 * 
 * This controller provides workspace awareness endpoints for the AI agent.
 * Uses API key authentication (service-to-service communication).
 * 
 * Endpoint: /api/internal/ai/workspace/*
 * Authentication: X-API-Key header (from EXTERNAL_SERVICE_API_KEY env var)
 * Context: X-Workspace-Id and X-User-Id headers
 */
@UseGuards(ApiKeyAuthGuard)
@Controller('internal/ai/workspace')
export class WorkspaceInternalController {
  private readonly logger = new Logger(WorkspaceInternalController.name);

  constructor(
    private readonly workspaceInternalService: WorkspaceInternalService,
    private readonly workspaceService: WorkspaceService,
    private readonly userService: UserService,
  ) {}

  /**
   * List all pages in workspace
   * POST /api/internal/ai/workspace/pages
   */
  @Post('pages')
  @HttpCode(HttpStatus.OK)
  async listWorkspacePages(
    @Body() dto: ListWorkspacePagesDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<ListWorkspacePagesResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);
    
    this.logger.log(
      `AI service listing pages (workspace: ${workspaceId}, user: ${userId})`,
    );

    return this.workspaceInternalService.listWorkspacePages(dto, workspace, userId);
  }

  /**
   * Get page structure (headings, sections)
   * POST /api/internal/ai/document/structure
   */
  @Post('structure')
  @HttpCode(HttpStatus.OK)
  async getPageStructure(
    @Body() dto: GetPageStructureDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<GetPageStructureResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);
    
    this.logger.log(
      `AI service getting page structure for ${dto.pageId} (workspace: ${workspaceId})`,
    );

    return this.workspaceInternalService.getPageStructure(dto, workspace, userId);
  }

  /**
   * Get page metadata
   * POST /api/internal/ai/document/metadata
   */
  @Post('metadata')
  @HttpCode(HttpStatus.OK)
  async getPageMetadata(
    @Body() dto: GetPageMetadataDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<GetPageMetadataResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);
    
    this.logger.log(
      `AI service getting page metadata for ${dto.pageId} (workspace: ${workspaceId})`,
    );

    return this.workspaceInternalService.getPageMetadata(dto, workspace, userId);
  }

  /**
   * Search workspace
   * POST /api/internal/ai/workspace/search
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  async searchWorkspace(
    @Body() dto: SearchWorkspaceDto,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<SearchWorkspaceResponseDto> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);
    
    this.logger.log(
      `AI service searching workspace for "${dto.query}" (workspace: ${workspaceId})`,
    );

    return this.workspaceInternalService.searchWorkspace(dto, workspace, userId);
  }

  /**
   * Validate workspace and user from headers
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
}
