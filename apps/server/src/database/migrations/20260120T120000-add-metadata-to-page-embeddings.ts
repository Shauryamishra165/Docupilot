import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
    // Add metadata column to store position and node information
    await sql`
        ALTER TABLE page_embeddings 
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
    `.execute(db);

    // Create index for querying by node type
    await sql`
        CREATE INDEX IF NOT EXISTS idx_page_embeddings_metadata_node_type 
        ON page_embeddings ((metadata->>'nodeType'))
    `.execute(db);

    // Create index for querying by node path
    await sql`
        CREATE INDEX IF NOT EXISTS idx_page_embeddings_metadata_node_path 
        ON page_embeddings USING GIN ((metadata->'nodePath'))
    `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
    await sql`
        DROP INDEX IF EXISTS idx_page_embeddings_metadata_node_path
    `.execute(db);

    await sql`
        DROP INDEX IF EXISTS idx_page_embeddings_metadata_node_type
    `.execute(db);

    await sql`
        ALTER TABLE page_embeddings 
        DROP COLUMN IF EXISTS metadata
    `.execute(db);
}
