import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../environment/environment.service';

@Injectable()
export class CloudAiClientService {
    private readonly logger = new Logger(CloudAiClientService.name);
    private readonly cloudAiUrl: string;

    constructor(private readonly environmentService: EnvironmentService) {
        // Get cloud AI URL from environment or use default
        this.cloudAiUrl =
            process.env.CLOUD_AI_URL || 'http://localhost:3001';
    }

    /**
     * Generate embeddings for a page via HTTP call to cloud-ai-server
     * Returns false if cloud-ai-server is not available (graceful degradation)
     */
    async generatePageEmbeddings(pageId: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.cloudAiUrl}/embeddings/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pageId }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.warn(
                    `Cloud AI server returned error for page ${pageId}: ${response.status} ${errorText}`,
                );
                return false;
            }

            this.logger.debug(`Successfully generated embeddings for page ${pageId}`);
            return true;
        } catch (error: any) {
            // Check if it's a connection error (server not running)
            if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
                this.logger.warn(
                    `Cloud AI server is not available at ${this.cloudAiUrl}. ` +
                    `Embeddings will be skipped. Start cloud-ai-server to enable embeddings.`,
                );
            } else {
                this.logger.error(
                    `Failed to call cloud AI service for page ${pageId}`,
                    error.message || error,
                );
            }
            return false; // Don't throw - allow main server to continue
        }
    }

    /**
     * Delete embeddings for a page via HTTP call to cloud-ai-server
     * Returns false if cloud-ai-server is not available (graceful degradation)
     */
    async deletePageEmbeddings(pageId: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.cloudAiUrl}/embeddings/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pageId }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.warn(
                    `Cloud AI server returned error deleting embeddings for page ${pageId}: ${response.status} ${errorText}`,
                );
                return false;
            }

            this.logger.debug(`Successfully deleted embeddings for page ${pageId}`);
            return true;
        } catch (error: any) {
            // Check if it's a connection error (server not running)
            if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
                this.logger.warn(
                    `Cloud AI server is not available at ${this.cloudAiUrl}. ` +
                    `Embedding deletion will be skipped.`,
                );
            } else {
                this.logger.error(
                    `Failed to call cloud AI service to delete embeddings for page ${pageId}`,
                    error.message || error,
                );
            }
            return false; // Don't throw - allow main server to continue
        }
    }
}
