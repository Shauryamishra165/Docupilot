import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PageService } from '../../../../core/page/services/page.service';
import { SpaceService } from '../../../../core/space/services/space.service';
import { Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  jsonToText,
} from '../../../../collaboration/collaboration.util';
import {
  ListWorkspacePagesDto,
  ListWorkspacePagesResponseDto,
  GetPageStructureDto,
  GetPageStructureResponseDto,
  GetPageMetadataDto,
  GetPageMetadataResponseDto,
  SearchWorkspaceDto,
  SearchWorkspaceResponseDto,
  PageHeadingDto,
} from './dto/workspace-api.dto';

@Injectable()
export class WorkspaceInternalService {
  private readonly logger = new Logger(WorkspaceInternalService.name);

  constructor(
    private readonly pageService: PageService,
    private readonly spaceService: SpaceService,
  ) {}

  /**
   * List pages in workspace
   * Returns all pages with their hierarchy
   */
  async listWorkspacePages(
    dto: ListWorkspacePagesDto,
    workspace: Workspace,
    userId: string,
  ): Promise<ListWorkspacePagesResponseDto> {
    this.logger.log(`Listing workspace pages for workspace ${workspace.id}`);

    try {
      // Get all spaces in the workspace
      const paginationOptions: PaginationOptions = { page: 1, limit: 100 } as PaginationOptions;
      const spacesResult = await this.spaceService.getWorkspaceSpaces(workspace.id, paginationOptions);
      const spaces = spacesResult.items || [];
      
      const allPages: any[] = [];
      const spaceInfos = spaces.map(space => ({
        id: space.id,
        name: space.name,
        slug: space.slug,
      }));

      // If spaceId is specified, only get pages from that space
      if (dto.spaceId) {
        const pagePagination: PaginationOptions = { page: 1, limit: 500 } as PaginationOptions;
        const pagesResult = await this.pageService.getSidebarPages(
          dto.spaceId,
          pagePagination,
          dto.pageId,
        );
        allPages.push(...(pagesResult.items || []));
      } else {
        // Get pages from all spaces
        for (const space of spaces) {
          try {
            const pagePagination: PaginationOptions = { page: 1, limit: 500 } as PaginationOptions;
            const pagesResult = await this.pageService.getSidebarPages(
              space.id,
              pagePagination,
              dto.pageId,
            );
            allPages.push(...(pagesResult.items || []));
          } catch (error) {
            this.logger.warn(`Error getting pages for space ${space.id}: ${error}`);
          }
        }
      }

      this.logger.log(`Found ${allPages.length} pages in ${spaces.length} spaces`);

      return {
        pages: allPages.map(page => ({
          id: page.id,
          slugId: page.slugId,
          title: page.title || 'Untitled',
          icon: page.icon,
          position: page.position,
          parentPageId: page.parentPageId,
          spaceId: page.spaceId,
          hasChildren: page.hasChildren || false,
        })),
        spaces: spaceInfos,
        success: true,
      };
    } catch (error) {
      this.logger.error(`Error listing workspace pages: ${error}`);
      throw error;
    }
  }

  /**
   * Get page structure (headings, sections)
   */
  async getPageStructure(
    dto: GetPageStructureDto,
    workspace: Workspace,
    userId: string,
  ): Promise<GetPageStructureResponseDto> {
    this.logger.log(`Getting page structure for ${dto.pageId}`);

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
      sections: [], // Can be enhanced to extract sections
      wordCount: textContent.trim().split(/\s+/).filter(w => w.length > 0).length,
      characterCount: textContent.length,
      success: true,
    };
  }

  /**
   * Get page metadata without full content
   */
  async getPageMetadata(
    dto: GetPageMetadataDto,
    workspace: Workspace,
    userId: string,
  ): Promise<GetPageMetadataResponseDto> {
    this.logger.log(`Getting page metadata for ${dto.pageId}`);

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
   * Search workspace for pages
   */
  async searchWorkspace(
    dto: SearchWorkspaceDto,
    workspace: Workspace,
    userId: string,
  ): Promise<SearchWorkspaceResponseDto> {
    this.logger.log(`Searching workspace for: ${dto.query}`);

    const searchType = dto.searchType || 'all';
    const limit = dto.limit || 10;
    const query = dto.query.toLowerCase();
    
    const results: any[] = [];

    // Get all spaces
    const paginationOptions: PaginationOptions = { page: 1, limit: 100 } as PaginationOptions;
    const spacesResult = await this.spaceService.getWorkspaceSpaces(workspace.id, paginationOptions);
    const spaces = spacesResult.items || [];
    const spaceMap = new Map(spaces.map(s => [s.id, s.name]));

    // Search through pages
    for (const space of spaces) {
      try {
        const pagePagination: PaginationOptions = { page: 1, limit: 500 } as PaginationOptions;
        const pagesResult = await this.pageService.getSidebarPages(
          space.id,
          pagePagination,
        );

        for (const page of (pagesResult.items || [])) {
          // Title search
          if (searchType === 'title' || searchType === 'all') {
            if (page.title?.toLowerCase().includes(query)) {
              results.push({
                pageId: page.id,
                title: page.title || 'Untitled',
                spaceId: page.spaceId,
                spaceName: spaceMap.get(page.spaceId),
                matchType: 'title',
                relevance: 1.0,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(`Error searching space ${space.id}: ${error}`);
      }

      if (results.length >= limit) break;
    }

    // Sort by relevance and limit
    const sortedResults = results
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, limit);

    return {
      query: dto.query,
      searchType,
      results: sortedResults,
      totalResults: sortedResults.length,
      success: true,
    };
  }

  /**
   * Extract headings from page content
   */
  private extractHeadings(content: any): PageHeadingDto[] {
    if (!content || !content.content) {
      return [];
    }

    const headings: PageHeadingDto[] = [];
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
