import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../constants';
import { CloudAiClientService } from '../../ai/cloud-ai-client.service';

interface PageJobData {
    pageIds: string[];
    workspaceId: string;
}

@Injectable()
@Processor(QueueName.AI_QUEUE)
export class EmbeddingProcessor extends WorkerHost {
    private readonly logger = new Logger(EmbeddingProcessor.name);

    constructor(
        @Optional() private readonly cloudAiClient?: CloudAiClientService,
    ) {
        super();
        
        if (!this.cloudAiClient) {
            this.logger.warn(
                'CloudAiClientService not available. Embedding jobs will be skipped. ' +
                'This is expected in Electron builds - embeddings are handled by cloud service.',
            );
        }
    }

    @OnWorkerEvent('active')
    onActive(job: Job) {
        this.logger.debug(`Processing job ${job.id} (${job.name})`);
    }

    @OnWorkerEvent('completed')
    onCompleted(job: Job) {
        this.logger.debug(`Completed job ${job.id} (${job.name})`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, error: Error) {
        this.logger.error(`Failed job ${job.id} (${job.name})`, error.stack);
    }

    async process(job: Job<PageJobData>): Promise<void> {
        this.logger.debug(`Processing job ${job.name} with data:`, job.data);

        switch (job.name) {
            case QueueJob.PAGE_CREATED:
                await this.handlePageCreated(job.data);
                break;

            case QueueJob.PAGE_CONTENT_UPDATED:
                await this.handlePageContentUpdated(job.data);
                break;

            case QueueJob.GENERATE_PAGE_EMBEDDINGS:
                await this.handleGenerateEmbeddings(job.data);
                break;

            case QueueJob.DELETE_PAGE_EMBEDDINGS:
                await this.handleDeleteEmbeddings(job.data);
                break;

            case QueueJob.PAGE_SOFT_DELETED:
                await this.handlePageSoftDeleted(job.data);
                break;

            case QueueJob.PAGE_RESTORED:
                await this.handlePageRestored(job.data);
                break;

            case QueueJob.PAGE_DELETED:
                await this.handlePageDeleted(job.data);
                break;

            case QueueJob.PAGE_MOVED_TO_SPACE:
                // No action needed for embeddings when moving to space
                break;

            default:
                this.logger.warn(`Unknown job type: ${job.name}`);
        }
    }

    private async handlePageCreated(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) {
            this.logger.debug('Skipping embedding generation - cloud AI client not available');
            return;
        }

        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.generatePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to generate embeddings for new page ${pageId}`, error);
            }
        }
    }

    private async handlePageContentUpdated(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.generatePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to update embeddings for page ${pageId}`, error);
            }
        }
    }

    private async handleGenerateEmbeddings(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.generatePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to generate embeddings for page ${pageId}`, error);
            }
        }
    }

    private async handleDeleteEmbeddings(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.deletePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to delete embeddings for page ${pageId}`, error);
            }
        }
    }

    private async handlePageSoftDeleted(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        // Soft delete: delete embeddings since page is in trash
        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.deletePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to delete embeddings for soft-deleted page ${pageId}`, error);
            }
        }
    }

    private async handlePageRestored(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        // Restore: regenerate embeddings
        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.generatePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to regenerate embeddings for restored page ${pageId}`, error);
            }
        }
    }

    private async handlePageDeleted(data: PageJobData): Promise<void> {
        if (!this.cloudAiClient) return;

        // Permanent delete: embeddings should cascade delete via FK
        // But we'll explicitly delete to be safe
        const { pageIds } = data;
        for (const pageId of pageIds) {
            try {
                await this.cloudAiClient.deletePageEmbeddings(pageId);
            } catch (error) {
                this.logger.error(`Failed to delete embeddings for deleted page ${pageId}`, error);
            }
        }
    }
}
