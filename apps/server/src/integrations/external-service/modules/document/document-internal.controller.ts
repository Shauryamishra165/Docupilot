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
import { WorkspaceService } from '../../../../core/workspace/services/workspace.service';
import { UserService } from '../../../../core/user/user.service';
import { PageService } from '../../../../core/page/services/page.service';
import { Workspace } from '@docmost/db/types/entity.types';
import { jsonToText } from '../../../../collaboration/collaboration.util';

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
    private readonly pageService: PageService,
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
   * Get page structure (headings, sections)
   * POST /api/internal/ai/document/structure
   */
  @Post('structure')
  @HttpCode(HttpStatus.OK)
  async getPageStructure(
    @Body() dto: { pageId: string },
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<any> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);

    this.logger.log(
      `AI service getting page structure for ${dto.pageId} (workspace: ${workspaceId})`,
    );

    // Get the page with content
    const page = await this.pageService.findById(
      dto.pageId,
      true, // includeContent
      false, // includeYdoc
      true, // includeSpace
    );

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    if (page.workspaceId !== workspace.id) {
      throw new ForbiddenException('Page does not belong to this workspace');
    }

    // Extract headings from content
    const headings = this.extractHeadings(page.content);
    
    // Get text content for word/char count
    const textContent = page.content ? jsonToText(page.content as any) : '';

    return {
      pageId: page.id,
      title: page.title || 'Untitled',
      headings,
      sections: [],
      wordCount: textContent.trim().split(/\s+/).filter(w => w.length > 0).length,
      characterCount: textContent.length,
      success: true,
    };
  }

  /**
   * Get page metadata
   * POST /api/internal/ai/document/metadata
   */
  @Post('metadata')
  @HttpCode(HttpStatus.OK)
  async getPageMetadata(
    @Body() dto: { pageId: string },
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string,
  ): Promise<any> {
    const workspace = await this.validateWorkspaceAndUser(workspaceId, userId);

    this.logger.log(
      `AI service getting page metadata for ${dto.pageId} (workspace: ${workspaceId})`,
    );

    // Get the page with related info
    const page = await this.pageService.findById(
      dto.pageId,
      true, // includeContent for word count
      false, // includeYdoc
      true, // includeSpace
    );

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    if (page.workspaceId !== workspace.id) {
      throw new ForbiddenException('Page does not belong to this workspace');
    }

    // Get text content for word/char count
    const textContent = page.content ? jsonToText(page.content as any) : '';

    return {
      pageId: page.id,
      title: page.title || 'Untitled',
      icon: page.icon,
      spaceId: page.spaceId,
      spaceName: (page as any).space?.name,
      parentPageId: page.parentPageId,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      creatorName: (page as any).creator?.name,
      lastEditorName: (page as any).lastUpdatedBy?.name,
      wordCount: textContent.trim().split(/\s+/).filter(w => w.length > 0).length,
      characterCount: textContent.length,
      success: true,
    };
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
   * Extract headings from page content
   */
  private extractHeadings(content: any): any[] {
    if (!content || !content.content) {
      return [];
    }

    const headings: any[] = [];
    let charPosition = 0;

    const traverse = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.type === 'heading' && node.attrs?.level) {
          const text = this.extractTextFromNode(node);
          headings.push({
            level: node.attrs.level,
            text,
            position: charPosition,
          });
        }

        // Track character position
        if (node.type === 'text' && node.text) {
          charPosition += node.text.length;
        } else if (node.type === 'paragraph' || node.type === 'heading') {
          charPosition += 1; // newline
        }

        // Traverse children
        if (node.content && Array.isArray(node.content)) {
          traverse(node.content);
        }
      }
    };

    traverse(content.content);
    return headings;
  }

  /**
   * Extract text from a node
   */
  private extractTextFromNode(node: any): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.map(child => this.extractTextFromNode(child)).join('');
    }

    return '';
  }

}

