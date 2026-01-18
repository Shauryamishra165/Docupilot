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
import { Workspace } from '@docmost/db/types/entity.types';
import {
  jsonToText,
  jsonToHtml,
  jsonToNode,
} from '../../../../collaboration/collaboration.util';
import { DocumentReadRequestDto, DocumentReadResponseDto } from './dto/document-read.dto';
import { Node } from '@tiptap/pm/model';

@Injectable()
export class DocumentService extends ExternalServiceClientBase {

  constructor(
    environmentService: EnvironmentService,
    private readonly pageService: PageService,
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


  /**
   * Convert text character position to document node position
   * Used by readDocument for range extraction
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
}

