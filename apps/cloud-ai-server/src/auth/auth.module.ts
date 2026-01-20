import { Module } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { EnvironmentModule } from '../integrations/environment/environment.module';

@Module({
    imports: [EnvironmentModule],
    providers: [ApiKeyAuthGuard],
    exports: [ApiKeyAuthGuard],
})
export class AuthModule {}
