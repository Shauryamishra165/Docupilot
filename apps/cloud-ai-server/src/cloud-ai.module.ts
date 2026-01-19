import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EmbeddingModule } from './embeddings/embedding.module';
import { AgentModule } from './agent/agent.module';
import { DatabaseModule } from './database/database.module';
import { EnvironmentModule } from './integrations/environment/environment.module';

@Module({
    imports: [
        EventEmitterModule.forRoot(),
        EnvironmentModule,
        DatabaseModule,
        EmbeddingModule,
        AgentModule, // Will be implemented later
        // AuthModule removed for now - will add subscription auth later
    ],
})
export class CloudAiModule {}
