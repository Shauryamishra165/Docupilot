/**
 * AI Tool Call Types
 * 
 * These types define the semantic tool calls that the AI service returns
 * and the frontend adapter converts into ProseMirror editor commands.
 */

export type AiToolCall =
  | InsertContentTool
  | ReplaceContentTool
  | DeleteContentTool
  | FormatTextTool
  | InsertBlockTool
  | FindAndReplaceTool
  | ApplyFormattingTool
  | ClearFormattingTool
  | InsertAfterSectionTool
  | TableEditTool;

export interface InsertContentTool {
  tool: 'insert_content';
  params: {
    content: string; // Text/markdown content
    position: 'start' | 'end' | 'cursor' | 'after_selection';
    contentType?: 'markdown' | 'html' | 'text'; // Content format (default: markdown)
  };
}

export interface ReplaceContentTool {
  tool: 'replace_content';
  params: {
    content: string; // Text/markdown content
    target: 'selection' | 'all';
    contentType?: 'markdown' | 'html' | 'text'; // Content format (default: markdown)
  };
}

export interface DeleteContentTool {
  tool: 'delete_content';
  params: {
    target: 'selection' | 'all';
  };
}

export interface FormatTextTool {
  tool: 'format_text';
  params: {
    format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code';
    target: 'selection' | 'word';
  };
}

export interface InsertBlockTool {
  tool: 'insert_block';
  params: {
    type: 'heading' | 'paragraph' | 'code_block' | 'callout' | 'list';
    content: string;
    attrs?: Record<string, any>; // e.g., { level: 2 } for heading, { type: 'info' } for callout
    position: 'start' | 'end' | 'cursor';
  };
}

export interface FindAndReplaceTool {
  tool: 'find_and_replace';
  params: {
    searchText: string;
    replaceText: string;
    replaceAll?: boolean;
    caseSensitive?: boolean;
  };
}

export interface ApplyFormattingTool {
  tool: 'apply_formatting';
  params: {
    format: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link';
    range?: { from: number; to: number };  // Optional: use text instead
    text?: string;  // Alternative to range - will find text and get range (with fuzzy fallback)
    useFuzzy?: boolean;  // Enable fuzzy search if exact match not found (default: true)
    attrs?: { href?: string };
  };
}

export interface ClearFormattingTool {
  tool: 'clear_formatting';
  params: {
    range?: { from: number; to: number };  // Optional: use text instead
    text?: string;  // Alternative to range - will find text and get range (with fuzzy fallback)
    useFuzzy?: boolean;  // Enable fuzzy search if exact match not found (default: true)
  };
}

/**
 * Semantic insertion - insert content after a specific section/heading
 */
export interface InsertAfterSectionTool {
  tool: 'insert_after_section';
  params: {
    content: string;            // Content to insert (markdown)
    sectionTitle: string;       // Title/text of the section to insert after
    contentType?: 'markdown' | 'html' | 'text';
  };
}

/**
 * Table editing - manipulate tables
 */
export interface TableEditTool {
  tool: 'table_edit';
  params: {
    action: 'add_row' | 'delete_row' | 'add_column' | 'delete_column' | 'update_cell' | 'create_table';
    tableIndex?: number;       // Which table in the document (0-indexed)
    rowIndex?: number;         // For row operations
    columnIndex?: number;      // For column operations
    content?: string;          // For update_cell or create_table
    rows?: number;             // For create_table
    columns?: number;          // For create_table
  };
}

/**
 * Response from AI service that includes tool calls
 */
export interface AiChatResponse {
  message?: string; // AI's text response
  toolCalls?: AiToolCall[]; // Tool calls to execute in the editor
  error?: string;
}

