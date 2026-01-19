import { Json, Timestamp, Generated } from '@docmost/db/types/db';

export interface EmbeddingMetadata {
    format: 'markdown' | 'text';
    chunkIndex: number;
}

// embeddings type
export interface PageEmbeddings {
  id: Generated<string>;
  pageId: string;
  spaceId: string;
  workspaceId: string;
  chunkIndex: Generated<number>;
  content: string;
  contentHash: string;
  embedding: number[];
  modelName: Generated<string>;
  metadata: Generated<Json | null>;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

