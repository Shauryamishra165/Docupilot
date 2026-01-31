import { IsOptional, IsString, IsNumber, IsEnum, Min, Max } from 'class-validator';

/**
 * DTOs for Workspace Internal API
 * Used by AI service for workspace awareness
 */

// List workspace pages
export class ListWorkspacePagesDto {
  @IsOptional()
  @IsString()
  spaceId?: string;

  @IsOptional()
  @IsString()
  pageId?: string;
}

export class WorkspacePageDto {
  id: string;
  slugId: string;
  title: string;
  icon?: string;
  position?: string;
  parentPageId?: string;
  spaceId: string;
  hasChildren: boolean;
}

export class WorkspaceSpaceDto {
  id: string;
  name: string;
  slug: string;
  icon?: string;
}

export class ListWorkspacePagesResponseDto {
  pages: WorkspacePageDto[];
  spaces: WorkspaceSpaceDto[];
  success: boolean;
}

// Get page structure
export class GetPageStructureDto {
  @IsString()
  pageId: string;
}

export class PageHeadingDto {
  level: number; // 1-6 for H1-H6
  text: string;
  position: number; // Character position in document
}

export class GetPageStructureResponseDto {
  pageId: string;
  title: string;
  headings: PageHeadingDto[];
  sections: any[];
  wordCount: number;
  characterCount: number;
  success: boolean;
}

// Get page metadata
export class GetPageMetadataDto {
  @IsString()
  pageId: string;
}

export class GetPageMetadataResponseDto {
  pageId: string;
  title: string;
  icon?: string;
  spaceId: string;
  spaceName?: string;
  parentPageId?: string;
  createdAt: string;
  updatedAt: string;
  creatorName?: string;
  lastEditorName?: string;
  wordCount: number;
  characterCount: number;
  success: boolean;
}

// Search workspace
export class SearchWorkspaceDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsEnum(['title', 'content', 'all'])
  searchType?: 'title' | 'content' | 'all';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SearchResultDto {
  pageId: string;
  title: string;
  spaceId: string;
  spaceName?: string;
  matchType: 'title' | 'content';
  snippet?: string;
  relevance?: number;
}

export class SearchWorkspaceResponseDto {
  query: string;
  searchType: string;
  results: SearchResultDto[];
  totalResults: number;
  success: boolean;
}
