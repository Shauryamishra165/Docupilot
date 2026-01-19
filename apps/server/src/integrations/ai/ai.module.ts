import { Module } from '@nestjs/common';
import { CloudAiClientService } from './cloud-ai-client.service';
import { EnvironmentModule } from '../environment/environment.module';

@Module({
    imports: [EnvironmentModule],
    providers: [CloudAiClientService],
    exports: [CloudAiClientService],
})
export class AiModule {}
