import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import WorkspaceAbilityFactory from '../../../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../../../core/casl/interfaces/workspace-ability.type';
import { RateLimiterService } from '../../rate-limiter.service';
import { DocumentService } from './document.service';
import {
  DocumentReadRequestDto,
  DocumentReadResponseDto,
} from './dto/document-read.dto';
import {
  ReplaceDocumentRequestDto,
  ReplaceDocumentResponseDto,
  InsertContentRequestDto,
  InsertContentResponseDto,
  ReplaceRangeRequestDto,
  ReplaceRangeResponseDto,
} from './dto/document-write.dto';

@UseGuards(JwtAuthGuard)
@Controller('external-service/ai/document')
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name);

  constructor(
    private readonly documentService: DocumentService,
    private readonly rateLimiterService: RateLimiterService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  /**
   * Read document content
   * POST /api/external-service/ai/document/read
   * 
   * Parameters:
   * - pageId (required): UUID of the page to read
   * - format (optional): Output format - 'json' | 'text' | 'html' | 'markdown' (default: 'text')
   * - includeMetadata (optional): Include page metadata (default: false)
   * 
   * Response format:
   * {
   *   pageId: string,
   *   title: string,
   *   content: string, // Formatted content
   *   format: string,
   *   metadata?: {
   *     wordCount: number,
   *     characterCount: number,
   *     createdAt: string,
   *     updatedAt: string,
   *     author?: string
   *   },
   *   success: boolean
   * }
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  async readDocument(
    @Body() dto: DocumentReadRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<DocumentReadResponseDto> {
    this.checkPermission(user, workspace, WorkspaceCaslAction.Read);
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} reading document ${dto.pageId} (workspace: ${workspace.id}, format: ${dto.format || 'text'})`,
    );

    return this.documentService.readDocument(dto, workspace, user.id);
  }

  /**
   * Replace entire document content
   * POST /api/external-service/ai/document/replace
   */
  @Post('replace')
  @HttpCode(HttpStatus.OK)
  async replaceDocument(
    @Body() dto: ReplaceDocumentRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<ReplaceDocumentResponseDto> {
    this.checkPermission(user, workspace, WorkspaceCaslAction.Manage);
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} replacing document ${dto.pageId} (workspace: ${workspace.id})`,
    );

    return this.documentService.replaceDocument(dto, workspace, user.id);
  }

  /**
   * Insert content at specified position
   * POST /api/external-service/ai/document/insert
   */
  @Post('insert')
  @HttpCode(HttpStatus.OK)
  async insertContent(
    @Body() dto: InsertContentRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<InsertContentResponseDto> {
    this.checkPermission(user, workspace, WorkspaceCaslAction.Manage);
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} inserting content into document ${dto.pageId} (workspace: ${workspace.id}, position: ${dto.position || 'end'})`,
    );

    return this.documentService.insertContent(dto, workspace, user.id);
  }

  /**
   * Replace content in a specific range
   * POST /api/external-service/ai/document/replace-range
   */
  @Post('replace-range')
  @HttpCode(HttpStatus.OK)
  async replaceRange(
    @Body() dto: ReplaceRangeRequestDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<ReplaceRangeResponseDto> {
    this.checkPermission(user, workspace, WorkspaceCaslAction.Manage);
    await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

    this.logger.log(
      `User ${user.id} replacing range in document ${dto.pageId} (workspace: ${workspace.id}, from: ${dto.from}, to: ${dto.to})`,
    );

    return this.documentService.replaceRange(dto, workspace, user.id);
  }

  /**
   * Shared permission check
   */
  private checkPermission(
    user: User,
    workspace: Workspace,
    action: WorkspaceCaslAction,
  ): void {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(action, WorkspaceCaslSubject.Settings)) {
      this.logger.warn(
        `User ${user.id} attempted document operation without permission (workspace: ${workspace.id})`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}

