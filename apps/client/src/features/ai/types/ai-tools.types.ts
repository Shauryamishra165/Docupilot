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
  | ClearFormattingTool;

export interface InsertContentTool {
  tool: 'insert_content';
  params: {
    content: string; // Text/markdown content
    position: 'start' | 'end' | 'cursor' | 'after_selection';
  };
}

export interface ReplaceContentTool {
  tool: 'replace_content';
  params: {
    content: string; // Text/markdown content
    target: 'selection' | 'all';
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
    range?: { from: number; to: number };
    attrs?: { href?: string };
  };
}

export interface ClearFormattingTool {
  tool: 'clear_formatting';
  params: {
    range?: { from: number; to: number };
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

