import { Module } from '@nestjs/common';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';
import { AiModule } from '../../integrations/ai/ai.module';

@Module({
    imports: [AiModule],
    controllers: [EmbeddingController],
    providers: [EmbeddingService],
    exports: [EmbeddingService],
})
export class EmbeddingModule { }
