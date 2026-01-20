import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { EmbeddingService } from './embedding.service';
import { SimilaritySearchDto } from './dto/similarity-search.dto';
import { CloudAiClientService } from '../../integrations/ai/cloud-ai-client.service';

@UseGuards(JwtAuthGuard)
@Controller('embeddings')
export class EmbeddingController {
    constructor(
        private readonly embeddingService: EmbeddingService,
        private readonly cloudAiClient: CloudAiClientService,
    ) { }

    /**
     * Search for similar pages based on a query
     * Uses vector similarity (cosine distance) to find relevant content
     */
    @Post('search')
    @HttpCode(HttpStatus.OK)
    async similaritySearch(
        @Body() dto: SimilaritySearchDto,
        @AuthUser() user: User,
    ) {
        const results = await this.embeddingService.findSimilarPages(
            dto.query,
            user.workspaceId,
            dto.limit ?? 10,
            dto.threshold ?? 0.7,
        );

        return {
            results,
            count: results.length,
        };
    }

    /**
     * Check if embeddings exist for a page
     * Returns status: { hasEmbeddings: boolean | null }
     * null indicates the Cloud AI server is not available
     */
    @Get('status/:pageId')
    @HttpCode(HttpStatus.OK)
    async getEmbeddingStatus(
        @Param('pageId') pageId: string,
        @AuthUser() user: User,
    ) {
        const hasEmbeddings = await this.cloudAiClient.checkEmbeddingStatus(pageId, {
            workspaceId: user.workspaceId,
            userId: user.id,
            pageId,
        });

        return { hasEmbeddings };
    }
}
