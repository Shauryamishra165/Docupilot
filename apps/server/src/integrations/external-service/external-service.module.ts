import { Module } from '@nestjs/common';
import { ExternalServiceController } from './external-service.controller';
import { ExternalServiceService } from './external-service.service';
import { AiChatService } from './ai-chat.service';
import { RateLimiterService } from './rate-limiter.service';
import { EnvironmentModule } from '../environment/environment.module';
import { CaslModule } from '../../core/casl/casl.module';

@Module({
  imports: [EnvironmentModule, CaslModule],
  controllers: [ExternalServiceController],
  providers: [ExternalServiceService, AiChatService, RateLimiterService],
  exports: [ExternalServiceService, AiChatService, RateLimiterService],
})
export class ExternalServiceModule {}

