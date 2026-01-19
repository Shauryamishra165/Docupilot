import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '../../types/kysely.types';
import { sql } from 'kysely';
import {
    InsertablePageEmbedding,
    PageEmbedding,
} from '@docmost/db/types/entity.types';
import { EmbeddingMetadata } from '../../types/embeddings.types';

export interface SimilarityResult {
    pageId: string;
    chunkIndex: number;
    content: string;
    distance: number;
    metadata?: EmbeddingMetadata | null;
}

@Injectable()
export class PageEmbeddingsRepo {
    private readonly logger = new Logger(PageEmbeddingsRepo.name);

    constructor(@InjectKysely() private readonly db: KyselyDB) { }

    /**
     * Find embedding by page ID and chunk index
     */
    async findByPageAndChunk(
        pageId: string,
        chunkIndex: number,
    ): Promise<PageEmbedding | undefined> {
        return this.db
            .selectFrom('pageEmbeddings')
            .selectAll()
            .where('pageId', '=', pageId)
            .where('chunkIndex', '=', chunkIndex)
            .executeTakeFirst();
    }

    /**
     * Find all embeddings for a page
     */
    async findByPageId(pageId: string): Promise<PageEmbedding[]> {
        return this.db
            .selectFrom('pageEmbeddings')
            .selectAll()
            .where('pageId', '=', pageId)
            .orderBy('chunkIndex', 'asc')
            .execute();
    }

    /**
     * Upsert an embedding (insert or update if exists)
     */
    async upsertEmbedding(data: {
        pageId: string;
        spaceId: string;
        workspaceId: string;
        chunkIndex: number;
        content: string;
        contentHash: string;
        embedding: number[];
        metadata?: EmbeddingMetadata | null;
    }): Promise<void> {
        const embeddingVector = `[${data.embedding.join(',')}]`;
        const metadataJson = data.metadata ? JSON.stringify(data.metadata) : '{}';

        // Use raw SQL for pgvector upsert
        await sql`
      INSERT INTO page_embeddings 
        (page_id, space_id, workspace_id, chunk_index, content, content_hash, embedding, metadata, updated_at)
      VALUES 
        (${data.pageId}, ${data.spaceId}, ${data.workspaceId}, ${data.chunkIndex}, 
         ${data.content}, ${data.contentHash}, ${embeddingVector}::vector, ${metadataJson}::jsonb, NOW())
      ON CONFLICT (page_id, chunk_index) 
      DO UPDATE SET 
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `.execute(this.db);
    }

    /**
     * Insert multiple embeddings for a page (bulk operation)
     */
    async insertEmbeddings(
        embeddings: Array<{
            pageId: string;
            spaceId: string;
            workspaceId: string;
            chunkIndex: number;
            content: string;
            contentHash: string;
            embedding: number[];
            metadata?: EmbeddingMetadata | null;
        }>,
    ): Promise<void> {
        if (embeddings.length === 0) return;

        for (const emb of embeddings) {
            await this.upsertEmbedding(emb);
        }
    }

    /**
     * Delete all embeddings for a page
     */
    async deleteByPageId(pageId: string): Promise<void> {
        await this.db
            .deleteFrom('pageEmbeddings')
            .where('pageId', '=', pageId)
            .execute();

        this.logger.debug(`Deleted embeddings for page ${pageId}`);
    }

    /**
     * Delete chunks after a given index (for when content is shortened)
     */
    async deleteChunksAfterIndex(
        pageId: string,
        lastValidIndex: number,
    ): Promise<void> {
        await this.db
            .deleteFrom('pageEmbeddings')
            .where('pageId', '=', pageId)
            .where('chunkIndex', '>', lastValidIndex)
            .execute();
    }

    /**
     * Find similar embeddings using cosine distance
     */
    async findSimilar(
        queryEmbedding: number[],
        workspaceId: string,
        limit: number = 10,
        threshold: number = 0.7,
    ): Promise<SimilarityResult[]> {
        const embeddingVector = `[${queryEmbedding.join(',')}]`;

        // Use pgvector's <=> operator for cosine distance
        const results = await sql<SimilarityResult & { metadata: any }>`
      SELECT 
        pe.page_id as "pageId",
        pe.chunk_index as "chunkIndex",
        pe.content,
        pe.metadata,
        pe.embedding <=> ${embeddingVector}::vector as distance
      FROM page_embeddings pe
      INNER JOIN pages p ON p.id = pe.page_id
      WHERE 
        pe.workspace_id = ${workspaceId}
        AND p.deleted_at IS NULL
        AND (pe.embedding <=> ${embeddingVector}::vector) <= ${threshold}
      ORDER BY distance ASC
      LIMIT ${limit}
    `.execute(this.db);

        return results.rows.map((row) => ({
            pageId: row.pageId,
            chunkIndex: row.chunkIndex,
            content: row.content,
            distance: row.distance,
            metadata: row.metadata as EmbeddingMetadata | null,
        }));
    }

    /**
     * Find embedding with full metadata by page and chunk
     */
    async findByPageAndChunkWithMetadata(
        pageId: string,
        chunkIndex: number,
    ): Promise<(Omit<PageEmbedding, 'metadata'> & { metadata: EmbeddingMetadata | null }) | undefined> {
        const result = await this.db
            .selectFrom('pageEmbeddings')
            .selectAll()
            .where('pageId', '=', pageId)
            .where('chunkIndex', '=', chunkIndex)
            .executeTakeFirst();

        if (!result) return undefined;

        // Safely parse metadata from Json type
        let parsedMetadata: EmbeddingMetadata | null = null;
        if (result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata)) {
            try {
                parsedMetadata = result.metadata as unknown as EmbeddingMetadata;
            } catch (error) {
                this.logger.warn(`Failed to parse metadata for page ${pageId} chunk ${chunkIndex}`);
            }
        }

        return {
            ...result,
            metadata: parsedMetadata,
        } as Omit<PageEmbedding, 'metadata'> & { metadata: EmbeddingMetadata | null };
    }

    /**
     * Count embeddings for a page
     */
    async countByPageId(pageId: string): Promise<number> {
        const result = await this.db
            .selectFrom('pageEmbeddings')
            .select((eb) => eb.fn.countAll().as('count'))
            .where('pageId', '=', pageId)
            .executeTakeFirst();

        return Number(result?.count ?? 0);
    }
}
