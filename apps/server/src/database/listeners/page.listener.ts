import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import { EnvironmentService } from '../../integrations/environment/environment.service';

export class PageEvent {
  pageIds: string[];
  workspaceId: string;
}

const EMBEDDING_DEBOUNCE_MS = 5000; // 5 seconds

@Injectable()
export class PageListener {
  private readonly logger = new Logger(PageListener.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    @InjectQueue(QueueName.SEARCH_QUEUE) private searchQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
  ) { }

  @OnEvent(EventName.PAGE_CREATED)
  async handlePageCreated(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_CREATED, {
        pageIds,
      });
    }

    await this.aiQueue.add(QueueJob.PAGE_CREATED, { pageIds, workspaceId });
  }

  @OnEvent(EventName.PAGE_UPDATED)
  async handlePageUpdated(event: PageEvent) {
    const { pageIds } = event;

    await this.searchQueue.add(QueueJob.PAGE_UPDATED, { pageIds });
  }

  /**
   * Handle page content updates with 5-second debounce for embeddings
   * Uses job deduplication to avoid redundant embedding generation
   */
  @OnEvent(EventName.PAGE_CONTENT_UPDATED)
  async handlePageContentUpdated(event: PageEvent) {
    const { pageIds, workspaceId } = event;

    for (const pageId of pageIds) {
      // Use jobId for deduplication - same page = same job
      // Delay of 5 seconds allows rapid edits to batch together
      await this.aiQueue.add(
        QueueJob.GENERATE_PAGE_EMBEDDINGS,
        { pageIds: [pageId], workspaceId },
        {
          jobId: `embedding:${pageId}`,
          delay: EMBEDDING_DEBOUNCE_MS,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }

    this.logger.debug(
      `Queued embedding generation for ${pageIds.length} pages with ${EMBEDDING_DEBOUNCE_MS}ms debounce`,
    );
  }

  @OnEvent(EventName.PAGE_DELETED)
  async handlePageDeleted(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_DELETED, { pageIds });
    }

    await this.aiQueue.add(QueueJob.PAGE_DELETED, { pageIds, workspaceId });
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageSoftDeleted(event: PageEvent) {
    const { pageIds, workspaceId } = event;

    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_SOFT_DELETED, { pageIds });
    }

    await this.aiQueue.add(QueueJob.PAGE_SOFT_DELETED, {
      pageIds,
      workspaceId,
    });
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageRestored(event: PageEvent) {
    const { pageIds, workspaceId } = event;
    if (this.isTypesense()) {
      await this.searchQueue.add(QueueJob.PAGE_RESTORED, { pageIds });
    }

    await this.aiQueue.add(QueueJob.PAGE_RESTORED, { pageIds, workspaceId });
  }

  isTypesense(): boolean {
    return this.environmentService.getSearchDriver() === 'typesense';
  }
}

