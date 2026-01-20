import { Module } from '@nestjs/common';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [AuthModule], // For API key authentication guard
    controllers: [EmbeddingController],
    providers: [EmbeddingService],
    exports: [EmbeddingService],
})
export class EmbeddingModule { }
