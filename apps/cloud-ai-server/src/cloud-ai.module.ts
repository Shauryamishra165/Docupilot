import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EmbeddingModule } from './embeddings/embedding.module';
import { AgentModule } from './agent/agent.module';
import { DatabaseModule } from './database/database.module';
import { EnvironmentModule } from './integrations/environment/environment.module';
import { AuthModule } from './auth/auth.module';

@Module({
    imports: [
        EventEmitterModule.forRoot(),
        EnvironmentModule,
        DatabaseModule,
        AuthModule, // For API key authentication
        EmbeddingModule,
        AgentModule, // Will be implemented later
    ],
})
export class CloudAiModule {}
