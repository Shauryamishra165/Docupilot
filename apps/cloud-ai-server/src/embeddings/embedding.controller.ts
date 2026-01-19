import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { SimilaritySearchDto } from './dto/similarity-search.dto';

@Controller('embeddings')
export class EmbeddingController {
    constructor(private readonly embeddingService: EmbeddingService) {}

    /**
     * Generate embeddings for a page
     * Called by main server via HTTP
     */
    @Post('generate')
    @HttpCode(HttpStatus.OK)
    async generateEmbeddings(@Body() body: { pageId: string }) {
        await this.embeddingService.generatePageEmbeddings(body.pageId);
        return { success: true, message: `Embeddings generated for page ${body.pageId}` };
    }

    /**
     * Delete embeddings for a page
     * Called by main server via HTTP
     */
    @Post('delete')
    @HttpCode(HttpStatus.OK)
    async deleteEmbeddings(@Body() body: { pageId: string }) {
        await this.embeddingService.deletePageEmbeddings(body.pageId);
        return { success: true, message: `Embeddings deleted for page ${body.pageId}` };
    }

    /**
     * Search for similar pages based on a query
     * Uses vector similarity (cosine distance) to find relevant content
     * TODO: Add authentication later
     */
    @Post('search')
    @HttpCode(HttpStatus.OK)
    async similaritySearch(@Body() dto: SimilaritySearchDto & { workspaceId?: string }) {
        // TODO: Get workspaceId from authentication when subscription is added
        const workspaceId = dto.workspaceId || 'default-workspace';
        
        const results = await this.embeddingService.findSimilarPages(
            dto.query,
            workspaceId,
            dto.limit ?? 10,
            dto.threshold ?? 0.7,
        );

        return {
            results,
            count: results.length,
        };
    }
}
