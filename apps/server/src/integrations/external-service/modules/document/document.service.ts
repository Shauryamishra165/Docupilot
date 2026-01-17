import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ExternalServiceClientBase } from '../../base/external-service-client.base';
import { EnvironmentService } from '../../../environment/environment.service';
import { PageService } from '../../../../core/page/services/page.service';
import { PageRepo } from '../../../../database/repos/page/page.repo';
import { Workspace } from '@docmost/db/types/entity.types';
import {
  jsonToText,
  jsonToHtml,
  htmlToJson,
  tiptapExtensions,
  jsonToNode,
} from '../../../../collaboration/collaboration.util';
import { DocumentReadRequestDto, DocumentReadResponseDto } from './dto/document-read.dto';
import {
  ReplaceDocumentRequestDto,
  ReplaceDocumentResponseDto,
  InsertContentRequestDto,
  InsertContentResponseDto,
  ReplaceRangeRequestDto,
  ReplaceRangeResponseDto,
} from './dto/document-write.dto';
import { markdownToHtml } from '@docmost/editor-ext';
import { Node } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';

@Injectable()
export class DocumentService extends ExternalServiceClientBase {

  constructor(
    environmentService: EnvironmentService,
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
  ) {
    super(environmentService, 'DocumentService');
  }

  /**
   * Read document content and return formatted content
   * Used by both public and internal endpoints
   */
  async readDocument(
    dto: DocumentReadRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<DocumentReadResponseDto> {
    // 1. Fetch and validate page
    const page = await this.validatePageAccess(dto.pageId, workspace);

    // 2. Extract range if specified
    let contentToFormat = page.content;
    if (dto.range) {
      const doc = jsonToNode(page.content as any);
      const currentText = jsonToText(page.content as any);

      // Validate range bounds
      if (dto.range.from < 0 || dto.range.to > currentText.length) {
        throw new BadRequestException(
          `Range out of bounds: document has ${currentText.length} characters`,
        );
      }

      // Convert character positions to document positions
      const fromPos = this.textPositionToDocPosition(doc, dto.range.from);
      const toPos = this.textPositionToDocPosition(doc, dto.range.to);

      // Extract slice
      const slice = doc.slice(fromPos, toPos);
      contentToFormat = slice.content.toJSON();
    }

    // 3. Format content based on requested format
    const formattedContent = this.formatContent(
      contentToFormat,
      dto.format || 'text',
    );

    // 4. Prepare metadata if requested
    const metadata = dto.includeMetadata
      ? this.extractMetadata(page, formattedContent)
      : undefined;

    // 5. Return formatted document content directly
    // Internal endpoint should return content, not forward to external service
    return {
      pageId: page.id,
      title: page.title,
      content: formattedContent,
      format: dto.format || 'text',
      metadata,
      success: true,
    };
  }

  // ========== Private Helper Methods ==========

  /**
   * Validate page access and return page
   */
  private async validatePageAccess(pageId: string, workspace: Workspace) {
    const page = await this.pageService.findById(
      pageId,
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

    return page;
  }

  /**
   * Format content based on requested format
   */
  private formatContent(
    content: any,
    format: 'json' | 'text' | 'html' | 'markdown',
  ): string {
    switch (format) {
      case 'json':
        return JSON.stringify(content, null, 2);
      case 'html':
        return jsonToHtml(content);
      case 'markdown':
        // For now, use text format for markdown (can be enhanced later)
        return jsonToText(content);
      case 'text':
      default:
        return jsonToText(content);
    }
  }

  /**
   * Extract metadata from page
   */
  private extractMetadata(page: any, content: string) {
    return {
      wordCount: content.trim().split(/\s+/).filter((w) => w.length > 0).length,
      characterCount: content.length,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      author: page.createdBy?.name,
    };
  }

  // ========== Write Operations ==========

  /**
   * Replace entire document content
   */
  async replaceDocument(
    dto: ReplaceDocumentRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<ReplaceDocumentResponseDto> {
    const page = await this.validatePageAccess(dto.pageId, workspace);

    // Convert content to ProseMirror JSON
    const prosemirrorJson = await this.convertContentToJson(
      dto.content,
      dto.contentType || 'json',
    );

    // Update page content
    await this.updatePageContent(page.id, prosemirrorJson, userId);

    return {
      pageId: page.id,
      success: true,
      message: 'Document content replaced successfully',
    };
  }

  /**
   * Insert content at specified position
   */
  async insertContent(
    dto: InsertContentRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<InsertContentResponseDto> {
    this.logger.log(`[INSERT] Starting insertContent for page ${dto.pageId}`);
    this.logger.log(`[INSERT] Position: ${dto.position || 'undefined'}, positionOffset: ${dto.positionOffset || 'undefined'}`);
    this.logger.log(`[INSERT] ContentType: ${dto.contentType || 'undefined'}`);
    this.logger.log(`[INSERT] Content preview: ${typeof dto.content === 'string' ? dto.content.substring(0, 100) : 'object'}`);

    const page = await this.validatePageAccess(dto.pageId, workspace);
    this.logger.log(`[INSERT] Page found: ${page.id}, current content length: ${page.content ? JSON.stringify(page.content).length : 0}`);

    // Convert content to ProseMirror JSON
    const contentJson = await this.convertContentToJson(
      dto.content,
      dto.contentType || 'json',
    );
    this.logger.log(`[INSERT] Content converted to JSON, structure: ${JSON.stringify(contentJson).substring(0, 200)}`);
    this.logger.log(`[INSERT] Content JSON has ${contentJson?.content?.length || 0} top-level nodes`);

    // Get current document
    const currentContentJson = page.content as any;
    const currentDoc = jsonToNode(currentContentJson);
    const currentText = jsonToText(currentContentJson);
    this.logger.log(`[INSERT] Current document text length: ${currentText.length}`);
    this.logger.log(`[INSERT] Current document content size: ${currentDoc.content.size}`);
    this.logger.log(`[INSERT] Current document has ${currentContentJson?.content?.length || 0} top-level nodes`);

    // Calculate insertion position
    let insertPos: number;
    const position = dto.position || 'end'; // Default to 'end' if undefined
    switch (position) {
      case 'start':
        insertPos = 1; // After doc node
        this.logger.log(`[INSERT] Position: start, insertPos: ${insertPos}`);
        break;
      case 'end':
        // If document is empty, insert at position 1 (after doc node)
        // Otherwise, insert at the end of content
        insertPos = currentDoc.content.size === 0 ? 1 : currentDoc.content.size;
        this.logger.log(`[INSERT] Position: end, insertPos: ${insertPos} (doc.content.size: ${currentDoc.content.size})`);
        break;
      case 'cursor':
        if (dto.positionOffset !== undefined && dto.positionOffset !== null) {
          insertPos = this.textPositionToDocPosition(currentDoc, dto.positionOffset);
          this.logger.log(`[INSERT] Position: cursor with offset ${dto.positionOffset}, calculated insertPos: ${insertPos}`);
        } else {
          insertPos = currentDoc.content.size === 0 ? 1 : currentDoc.content.size;
          this.logger.log(`[INSERT] Position: cursor but no offset provided, defaulting to end, insertPos: ${insertPos}`);
        }
        break;
      default:
        insertPos = currentDoc.content.size === 0 ? 1 : currentDoc.content.size;
        this.logger.log(`[INSERT] Position: ${position} (unknown), defaulting to end, insertPos: ${insertPos}`);
    }

    // Insert content
    const contentNode = jsonToNode(contentJson);
    this.logger.log(`[INSERT] Content node created, content fragment size: ${contentNode.content.size}`);
    
    const tr = new Transform(currentDoc);
    this.logger.log(`[INSERT] Transform created, attempting insert at position ${insertPos}`);
    
    try {
      tr.insert(insertPos, contentNode.content);
      this.logger.log(`[INSERT] Insert successful, new doc content size: ${tr.doc.content.size}`);
    } catch (error: any) {
      this.logger.error(`[INSERT] Transform.insert failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to insert content: ${error.message}`);
    }

    const updatedJson = tr.doc.toJSON();
    this.logger.log(`[INSERT] Updated JSON created, has ${updatedJson?.content?.length || 0} top-level nodes`);
    const updatedText = jsonToText(updatedJson);
    this.logger.log(`[INSERT] Updated text length: ${updatedText.length} (was ${currentText.length})`);

    // Validate the document structure
    try {
      const validationDoc = jsonToNode(updatedJson);
      this.logger.log(`[INSERT] Document validation successful`);
    } catch (error: any) {
      this.logger.error(`[INSERT] Document validation failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Invalid document structure after insert: ${error.message}`);
    }

    // Update page content
    await this.updatePageContent(page.id, updatedJson, userId);
    this.logger.log(`[INSERT] Page content updated in database`);

    return {
      pageId: page.id,
      success: true,
      message: 'Content inserted successfully',
      insertedAt: insertPos,
    };
  }

  /**
   * Replace content in a specific range
   */
  async replaceRange(
    dto: ReplaceRangeRequestDto,
    workspace: Workspace,
    userId: string,
  ): Promise<ReplaceRangeResponseDto> {
    const page = await this.validatePageAccess(dto.pageId, workspace);

    // Validate range
    if (dto.from >= dto.to) {
      throw new BadRequestException('Invalid range: from must be less than to');
    }

    // Convert content to ProseMirror JSON
    const contentJson = await this.convertContentToJson(
      dto.content,
      dto.contentType || 'json',
    );

    // Get current document
    const currentDoc = jsonToNode(page.content as any);
    const currentText = jsonToText(page.content as any);

    // Validate range bounds
    if (dto.from < 0 || dto.to > currentText.length) {
      throw new BadRequestException(
        `Range out of bounds: document has ${currentText.length} characters`,
      );
    }

    // Convert character positions to document positions
    // This is approximate - for exact positions, we'd need to map text positions to doc positions
    const fromPos = this.textPositionToDocPosition(currentDoc, dto.from);
    const toPos = this.textPositionToDocPosition(currentDoc, dto.to);

    // Replace content
    const contentNode = jsonToNode(contentJson);
    const tr = new Transform(currentDoc);
    tr.replaceWith(fromPos, toPos, contentNode.content);

    const updatedJson = tr.doc.toJSON();

    // Update page content
    await this.updatePageContent(page.id, updatedJson, userId);

    return {
      pageId: page.id,
      success: true,
      message: 'Content range replaced successfully',
      replacedFrom: fromPos,
      replacedTo: toPos,
    };
  }

  // ========== Content Conversion Helpers ==========

  /**
   * Convert content from various formats to ProseMirror JSON
   */
  private async convertContentToJson(
    content: string | object,
    contentType: 'json' | 'html' | 'markdown' | 'text',
  ): Promise<any> {
    try {
      switch (contentType) {
        case 'json':
          if (typeof content === 'string') {
            return JSON.parse(content);
          }
          return content;

        case 'html':
          if (typeof content !== 'string') {
            throw new BadRequestException('HTML content must be a string');
          }
          return htmlToJson(content);

        case 'markdown':
          if (typeof content !== 'string') {
            throw new BadRequestException('Markdown content must be a string');
          }
          const html = await markdownToHtml(content);
          return htmlToJson(html);

        case 'text':
          if (typeof content !== 'string') {
            throw new BadRequestException('Text content must be a string');
          }
          // Convert plain text to ProseMirror JSON via markdown pipeline
          return await this.textToJson(content);

        default:
          throw new BadRequestException(`Unsupported content type: ${contentType}`);
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      this.logger.error(`Error converting content to JSON: ${errorMessage}`, error);
      throw new BadRequestException(`Failed to convert content: ${errorMessage}`);
    }
  }

  /**
   * Convert plain text to ProseMirror JSON
   * Uses markdown pipeline: text → markdown → HTML → JSON
   * Plain text is valid markdown, so we leverage existing utilities
   */
  private async textToJson(text: string): Promise<any> {
    // Plain text is valid markdown (no syntax = plain paragraph)
    // Use existing markdown pipeline for proper conversion
    const html = await markdownToHtml(text);
    return htmlToJson(html);
  }

  /**
   * Convert text character position to document node position
   * This is approximate - maps text offset to document position
   */
  private textPositionToDocPosition(doc: Node, textPos: number): number {
    let currentPos = 0;
    let docPos = 1; // Start after doc node

    const walk = (node: Node, pos: number): number => {
      if (node.isText) {
        const nodeTextLength = node.textContent.length;
        if (currentPos + nodeTextLength >= textPos) {
          return pos + (textPos - currentPos);
        }
        currentPos += nodeTextLength;
        return pos + nodeTextLength;
      }

      let childPos = pos + 1;
      node.forEach((child: Node, offset: number) => {
        childPos = walk(child, childPos);
      });
      return childPos;
    };

    doc.forEach((child: Node) => {
      docPos = walk(child, docPos);
    });

    return Math.min(docPos, doc.content.size);
  }

  /**
   * Update page content in database
   */
  private async updatePageContent(
    pageId: string,
    prosemirrorJson: any,
    userId: string,
  ): Promise<void> {
    // Generate text content
    const textContent = jsonToText(prosemirrorJson);

    // Generate ydoc
    const ydoc = TiptapTransformer.toYdoc(
      prosemirrorJson,
      'default',
      tiptapExtensions,
    );
    const ydocState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

    // Get current page to preserve contributors
    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // Update contributors
    const contributors = new Set<string>(page.contributorIds || []);
    contributors.add(userId);
    const contributorIds = Array.from(contributors);

    // Update page
    await this.pageRepo.updatePage(
      {
        content: prosemirrorJson,
        textContent: textContent,
        ydoc: ydocState,
        lastUpdatedById: userId,
        contributorIds: contributorIds,
        updatedAt: new Date(),
      },
      pageId,
    );

    this.logger.log(`Page content updated: ${pageId}`);
  }
}

