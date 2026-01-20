import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import {
    FastifyAdapter,
    NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { CloudAiModule } from './cloud-ai.module';

async function bootstrap() {
    const logger = new Logger('CloudAiServer');

    const app = await NestFactory.create<NestFastifyApplication>(
        CloudAiModule,
        new FastifyAdapter(),
    );

    // Enable CORS - restrict to backend origin for security
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3000']; // Default to main server origin
    
    app.enableCors({
        origin: allowedOrigins,
        credentials: true,
        allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Workspace-Id', 'X-User-Id', 'X-Page-Id'],
    });

    // Global validation pipe
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // Use CLOUD_AI_PORT or default to 3001 (different from main server's 3000)
    const port = process.env.CLOUD_AI_PORT || 3001;
    
    // Fastify requires host to be specified explicitly
    await app.listen(port, '0.0.0.0');

    logger.log(`☁️ Cloud AI Server running on http://localhost:${port}`);
    logger.log(`📡 Ready to accept AI requests`);
}

bootstrap();
