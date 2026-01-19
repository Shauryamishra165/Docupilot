import { Injectable, Logger } from '@nestjs/common';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany } from 'ai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createHash } from 'crypto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageEmbeddingsRepo } from '@docmost/db/repos/embedding/page-embeddings.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { createStructuredChunksWithPositions } from './utils/structured-chunking.util';
import { jsonToText } from '../../collaboration/collaboration.util';

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DEFAULT_EMBEDDING_DIMENSIONS = 768;
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

@Injectable()
export class EmbeddingService {
    private readonly logger = new Logger(EmbeddingService.name);
    private readonly splitter: RecursiveCharacterTextSplitter;

    constructor(
        private readonly environmentService: EnvironmentService,
        private readonly pageRepo: PageRepo,
        private readonly embeddingsRepo: PageEmbeddingsRepo,
    ) {
        this.splitter = new RecursiveCharacterTextSplitter({
            chunkSize: DEFAULT_CHUNK_SIZE,
            chunkOverlap: DEFAULT_CHUNK_OVERLAP,
        });
    }

    /**
     * Get the Gemini client for embedding generation
     */
    private getGeminiClient() {
        const apiKey = this.environmentService.getGeminiApiKey();
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is not configured');
        }
        return createGoogleGenerativeAI({ apiKey });
    }

    /**
     * Get the embedding model name
     */
    private getModelName(): string {
        return (
            this.environmentService.getAiEmbeddingModel() || DEFAULT_EMBEDDING_MODEL
        );
    }

    /**
     * Generate SHA256 hash of content for change detection
     */
    private hashContent(content: string): string {
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * Normalize text for comparison (removes extra whitespace)
     */
    private normalizeText(text: string): string {
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Generate embeddings for a page (incremental update)
     * Only regenerates embeddings for changed chunks
     * Uses Markdown-based chunking to preserve document structure
     */
    async generatePageEmbeddings(pageId: string): Promise<void> {
        this.logger.debug(`Generating embeddings for page ${pageId}`);

        // Get page with JSON content for structured chunking
        const page = await this.pageRepo.findById(pageId, {
            includeContent: true,
            includeTextContent: true,
        });

        if (!page) {
            this.logger.warn(`Page ${pageId} not found, skipping embedding`);
            return;
        }

        // Skip deleted pages
        if (page.deletedAt) {
            this.logger.debug(`Page ${pageId} is deleted, skipping embedding`);
            return;
        }

        // Use Markdown-based chunking if JSON content is available
        let chunks: Array<{ text: string; metadata?: any }>;

        if (page.content && typeof page.content === 'object' && !Array.isArray(page.content)) {
            // Convert to Markdown first, then chunk with MarkdownTextSplitter
            // This preserves tables, headings, lists, code blocks, etc.
            const structuredChunks = await createStructuredChunksWithPositions(
                page.content as any,
            );
            chunks = structuredChunks.map((chunk) => ({
                text: chunk.text,
                metadata: chunk.metadata,
            }));
            this.logger.debug(
                `Split page ${pageId} into ${chunks.length} Markdown-based chunks`,
            );
        } else {
            // Fallback to text-based chunking
            const textContent = page.textContent || '';
            if (!textContent.trim()) {
                await this.embeddingsRepo.deleteByPageId(pageId);
                this.logger.debug(`Page ${pageId} has no content, cleared embeddings`);
                return;
            }

            const textChunks = await this.splitter.splitText(textContent);
            chunks = textChunks.map((text, index) => ({
                text,
                metadata: { format: 'text', chunkIndex: index },
            }));
            this.logger.debug(`Split page ${pageId} into ${chunks.length} text chunks`);
        }

        // Process each chunk incrementally
        let regeneratedCount = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const contentHash = this.hashContent(chunk.text);

            // Check if this chunk already exists with the same content
            const existing = await this.embeddingsRepo.findByPageAndChunk(pageId, i);
            if (existing && existing.contentHash === contentHash) {
                // Content unchanged, skip this chunk
                continue;
            }

            // Generate embedding for this chunk
            try {
                const embedding = await this.generateEmbedding(chunk.text);

                await this.embeddingsRepo.upsertEmbedding({
                    pageId,
                    spaceId: page.spaceId,
                    workspaceId: page.workspaceId,
                    chunkIndex: i,
                    content: chunk.text,
                    contentHash,
                    embedding,
                    metadata: chunk.metadata || null,
                });

                regeneratedCount++;
            } catch (error) {
                this.logger.error(
                    `Failed to generate embedding for page ${pageId} chunk ${i}`,
                    error,
                );
                throw error;
            }
        }

        // Remove any extra chunks (if content was shortened)
        if (chunks.length > 0) {
            await this.embeddingsRepo.deleteChunksAfterIndex(
                pageId,
                chunks.length - 1,
            );
        }

        this.logger.log(
            `Generated ${regeneratedCount} embeddings for page ${pageId} (${chunks.length} total chunks)`,
        );
    }

    /**
     * Generate embedding vector for a single text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        const gemini = this.getGeminiClient();
        const modelName = this.getModelName();
        const dimension = this.environmentService.getAiEmbeddingDimension();
        const { embeddings } = await embedMany({
            model: gemini.textEmbeddingModel(modelName),
            values: [text],
        });

        if (!embeddings || embeddings.length === 0) {
            throw new Error('Failed to generate embedding: empty response');
        }

        return embeddings[0];
    }

    /**
     * Delete all embeddings for a page
     */
    async deletePageEmbeddings(pageId: string): Promise<void> {
        await this.embeddingsRepo.deleteByPageId(pageId);
        this.logger.debug(`Deleted embeddings for page ${pageId}`);
    }

    /**
     * Find similar pages based on a query
     */
    async findSimilarPages(
        query: string,
        workspaceId: string,
        limit: number = 10,
        threshold: number = 0.7,
    ) {
        // Generate embedding for the query
        const queryEmbedding = await this.generateEmbedding(query);

        // Find similar chunks
        return this.embeddingsRepo.findSimilar(
            queryEmbedding,
            workspaceId,
            limit,
            threshold,
        );
    }
}
