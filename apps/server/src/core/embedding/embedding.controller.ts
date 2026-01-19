import {
    Controller,
    Post,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { EmbeddingService } from './embedding.service';
import { SimilaritySearchDto } from './dto/similarity-search.dto';

@UseGuards(JwtAuthGuard)
@Controller('embeddings')
export class EmbeddingController {
    constructor(private readonly embeddingService: EmbeddingService) { }

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
}
