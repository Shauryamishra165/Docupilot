import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    Headers,
    UseGuards,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { SimilaritySearchDto } from './dto/similarity-search.dto';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard';

@Controller('embeddings')
@UseGuards(ApiKeyAuthGuard)
export class EmbeddingController {
    private readonly logger = new Logger(EmbeddingController.name);

    constructor(private readonly embeddingService: EmbeddingService) {}

    /**
     * Generate embeddings for a page
     * Called by main server via HTTP
     * Requires: X-API-Key header
     * Optional: X-Workspace-Id, X-User-Id, X-Page-Id headers for tracking
     */
    @Post('generate')
    @HttpCode(HttpStatus.OK)
    async generateEmbeddings(
        @Body() body: { pageId: string },
        @Headers('x-workspace-id') workspaceId?: string,
        @Headers('x-user-id') userId?: string,
        @Headers('x-page-id') pageId?: string,
    ) {
        // Log context headers for tracking (if provided)
        if (workspaceId || userId || pageId) {
            this.logger.debug(
                `Generating embeddings with context: workspace=${workspaceId}, user=${userId}, page=${pageId || body.pageId}`,
            );
        }

        await this.embeddingService.generatePageEmbeddings(body.pageId);
        return { success: true, message: `Embeddings generated for page ${body.pageId}` };
    }

    /**
     * Delete embeddings for a page
     * Called by main server via HTTP
     * Requires: X-API-Key header
     * Optional: X-Workspace-Id, X-User-Id, X-Page-Id headers for tracking
     */
    @Post('delete')
    @HttpCode(HttpStatus.OK)
    async deleteEmbeddings(
        @Body() body: { pageId: string },
        @Headers('x-workspace-id') workspaceId?: string,
        @Headers('x-user-id') userId?: string,
        @Headers('x-page-id') pageId?: string,
    ) {
        // Log context headers for tracking (if provided)
        if (workspaceId || userId || pageId) {
            this.logger.debug(
                `Deleting embeddings with context: workspace=${workspaceId}, user=${userId}, page=${pageId || body.pageId}`,
            );
        }

        await this.embeddingService.deletePageEmbeddings(body.pageId);
        return { success: true, message: `Embeddings deleted for page ${body.pageId}` };
    }

    /**
     * Search for similar pages based on a query
     * Uses vector similarity (cosine distance) to find relevant content
     * If pageId is provided, searches only within that page's chunks
     * If pageId is not provided, searches across the entire workspace
     * Requires: X-API-Key header
     * Requires: X-Workspace-Id header (or in body as fallback)
     */
    @Post('search')
    @HttpCode(HttpStatus.OK)
    async similaritySearch(
        @Body() dto: SimilaritySearchDto & { workspaceId?: string },
        @Headers('x-workspace-id') workspaceIdHeader?: string,
        @Headers('x-user-id') userId?: string,
        @Headers('x-page-id') pageIdHeader?: string,
    ) {
        // Get workspaceId from header (preferred) or body (fallback)
        const workspaceId = workspaceIdHeader || dto.workspaceId;
        
        if (!workspaceId) {
            throw new BadRequestException('Workspace ID is required (provide via X-Workspace-Id header or workspaceId in body)');
        }

        // Get pageId from header (preferred), body, or undefined (searches entire workspace)
        const pageId = pageIdHeader || dto.pageId;

        if (userId) {
            this.logger.debug(
                `Similarity search with context: workspace=${workspaceId}, user=${userId}, pageId=${pageId || 'all pages'}`,
            );
        }
        
        const results = await this.embeddingService.findSimilarPages(
            dto.query,
            workspaceId,
            dto.limit ?? 10,
            dto.threshold ?? 0.7,
            pageId,
        );

        return {
            results,
            count: results.length,
        };
    }
}
