import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';

/**
 * API Key Authentication Guard
 * 
 * Validates requests using X-API-Key header.
 * Used for service-to-service communication (e.g., AI service calling backend).
 * 
 * Environment Variable: EXTERNAL_SERVICE_API_KEY
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);
  private readonly validApiKey: string;

  constructor(private readonly environmentService: EnvironmentService) {
    this.validApiKey =
      process.env.EXTERNAL_SERVICE_API_KEY ||
      this.environmentService.getExternalServiceApiKey() ||
      'parth128'; // Fallback for development

    if (!this.validApiKey) {
      this.logger.warn('EXTERNAL_SERVICE_API_KEY not set - API key authentication will fail');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      this.logger.warn('Missing X-API-Key header');
      throw new UnauthorizedException('API key is required');
    }

    if (apiKey !== this.validApiKey) {
      this.logger.warn('Invalid API key provided');
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}

