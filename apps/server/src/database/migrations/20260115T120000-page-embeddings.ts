import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    // Enable pgvector extension
    await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

    // Create page_embeddings table
    await db.schema
        .createTable('page_embeddings')
        .addColumn('id', 'uuid', (col) =>
            col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
        )
        .addColumn('page_id', 'uuid', (col) =>
            col.notNull().references('pages.id').onDelete('cascade'),
        )
        .addColumn('space_id', 'uuid', (col) => col.notNull())
        .addColumn('workspace_id', 'uuid', (col) => col.notNull())
        .addColumn('chunk_index', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('content', 'text', (col) => col.notNull())
        .addColumn('content_hash', 'varchar(64)', (col) => col.notNull())
        .addColumn('model_name', 'varchar(100)', (col) =>
            col.notNull().defaultTo('text-embedding-004'),
        )
        .addColumn('created_at', 'timestamptz', (col) =>
            col.notNull().defaultTo(sql`now()`),
        )
        .addColumn('updated_at', 'timestamptz', (col) =>
            col.notNull().defaultTo(sql`now()`),
        )
        .execute();

    // Add vector column (Kysely doesn't support vector type natively)
    await sql`ALTER TABLE page_embeddings ADD COLUMN embedding vector(768)`.execute(db);

    // Create indexes
    await db.schema
        .createIndex('idx_page_embeddings_page_chunk')
        .on('page_embeddings')
        .columns(['page_id', 'chunk_index'])
        .unique()
        .execute();

    await db.schema
        .createIndex('idx_page_embeddings_page_id')
        .on('page_embeddings')
        .column('page_id')
        .execute();

    await db.schema
        .createIndex('idx_page_embeddings_workspace_id')
        .on('page_embeddings')
        .column('workspace_id')
        .execute();

    // Create vector similarity index (IVFFlat for approximate search)
    await sql`
    CREATE INDEX idx_page_embeddings_vector 
    ON page_embeddings 
    USING ivfflat (embedding vector_cosine_ops) 
    WITH (lists = 100)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('page_embeddings').ifExists().execute();
}