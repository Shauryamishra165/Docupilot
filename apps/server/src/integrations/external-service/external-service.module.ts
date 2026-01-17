import { Module } from '@nestjs/common';
import { ExternalServiceController } from './external-service.controller';
import { ExternalServiceService } from './external-service.service';
import { AiChatService } from './ai-chat.service';
import { RateLimiterService } from './rate-limiter.service';
import { EnvironmentModule } from '../environment/environment.module';
import { CaslModule } from '../../core/casl/casl.module';
import { PageModule } from '../../core/page/page.module';
import { WorkspaceModule } from '../../core/workspace/workspace.module';
import { UserModule } from '../../core/user/user.module';
import { DocumentController } from './modules/document/document.controller';
import { DocumentInternalController } from './modules/document/document-internal.controller';
import { DocumentService } from './modules/document/document.service';

@Module({
  imports: [EnvironmentModule, CaslModule, PageModule, WorkspaceModule, UserModule],
  controllers: [
    ExternalServiceController,
    DocumentController,
    DocumentInternalController,
  ],
  providers: [
    ExternalServiceService,
    AiChatService,
    RateLimiterService,
    DocumentService,
  ],
  exports: [
    ExternalServiceService,
    AiChatService,
    RateLimiterService,
    DocumentService,
  ],
})
export class ExternalServiceModule {}

