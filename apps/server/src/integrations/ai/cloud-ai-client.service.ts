import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../environment/environment.service';

interface CloudAiRequestOptions {
    workspaceId?: string;
    userId?: string;
    pageId?: string;
}

@Injectable()
export class CloudAiClientService {
    private readonly logger = new Logger(CloudAiClientService.name);
    private readonly cloudAiUrl: string;
    private readonly apiKey: string;

    constructor(private readonly environmentService: EnvironmentService) {
        // Get cloud AI URL from environment or use default
        this.cloudAiUrl =
            process.env.CLOUD_AI_URL || 'http://localhost:3001';
        
        // Get API key for authentication
        this.apiKey =
            process.env.EXTERNAL_SERVICE_API_KEY ||
            this.environmentService.getExternalServiceApiKey() ||
            'parth128'; // Fallback for development
    }

    /**
     * Build headers for Cloud AI server requests
     */
    private buildHeaders(options?: CloudAiRequestOptions): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
        };

        // Add context headers if provided
        if (options?.workspaceId) {
            headers['X-Workspace-Id'] = options.workspaceId;
        }
        if (options?.userId) {
            headers['X-User-Id'] = options.userId;
        }
        if (options?.pageId) {
            headers['X-Page-Id'] = options.pageId;
        }

        return headers;
    }

    /**
     * Generate embeddings for a page via HTTP call to cloud-ai-server
     * Returns false if cloud-ai-server is not available (graceful degradation)
     */
    async generatePageEmbeddings(
        pageId: string,
        options?: CloudAiRequestOptions,
    ): Promise<boolean> {
        try {
            const headers = this.buildHeaders({ ...options, pageId });

            const response = await fetch(`${this.cloudAiUrl}/embeddings/generate`, {
                method: 'POST',
                headers,
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
    async deletePageEmbeddings(
        pageId: string,
        options?: CloudAiRequestOptions,
    ): Promise<boolean> {
        try {
            const headers = this.buildHeaders({ ...options, pageId });

            const response = await fetch(`${this.cloudAiUrl}/embeddings/delete`, {
                method: 'POST',
                headers,
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

    /**
     * Check if embeddings exist for a page
     * Returns null if cloud-ai-server is not available (graceful degradation)
     */
    async checkEmbeddingStatus(
        pageId: string,
        options?: CloudAiRequestOptions,
    ): Promise<boolean | null> {
        try {
            const headers = this.buildHeaders(options);

            const response = await fetch(`${this.cloudAiUrl}/embeddings/status/${pageId}`, {
                method: 'GET',
                headers,
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.warn(
                    `Cloud AI server returned error checking status for page ${pageId}: ${response.status} ${errorText}`,
                );
                return null;
            }

            const data = await response.json();
            return data.hasEmbeddings ?? false;
        } catch (error: any) {
            // Check if it's a connection error (server not running)
            if (error.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNREFUSED') {
                this.logger.warn(
                    `Cloud AI server is not available at ${this.cloudAiUrl}. ` +
                    `Embedding status check will return null.`,
                );
            } else {
                this.logger.error(
                    `Failed to check embedding status for page ${pageId}`,
                    error.message || error,
                );
            }
            return null; // Return null to indicate status is unknown
        }
    }
}
