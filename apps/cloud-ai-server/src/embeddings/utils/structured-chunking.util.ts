import { JSONContent } from '@tiptap/core';
import { MarkdownTextSplitter } from '@langchain/textsplitters';
import { jsonToMarkdown } from './json-to-markdown.util';

export interface ChunkWithPosition {
    text: string; // Contains Markdown-formatted text
    metadata: {
        format: 'markdown';
        chunkIndex: number;
    };
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Create structured chunks from TipTap JSON by converting to Markdown first
 * This preserves document structure (tables, headings, lists, code blocks, etc.)
 */
export async function createStructuredChunksWithPositions(
    tiptapJson: JSONContent,
): Promise<ChunkWithPosition[]> {
    // Convert entire document to Markdown first
    const markdown = jsonToMarkdown(tiptapJson);
    
    // Use MarkdownTextSplitter to split while preserving structure
    const splitter = new MarkdownTextSplitter({
        chunkSize: DEFAULT_CHUNK_SIZE,
        chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    });
    
    // Split the markdown into chunks
    const textChunks = await splitter.splitText(markdown);
    
    // Convert to chunks with metadata
    const chunks: ChunkWithPosition[] = textChunks.map((text, index) => ({
        text,
        metadata: {
            format: 'markdown',
            chunkIndex: index,
        },
    }));
    
    return chunks;
}
