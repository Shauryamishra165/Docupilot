/**
 * AI Text Transform Types
 * 
 * Types for the AI text transformation feature that allows users to
 * improve, fix grammar, change tone, etc. of selected text.
 */

export type AiCommandType = 'improve' | 'fix-grammar' | 'change-tone';

export interface AiTransformRequest {
  /** The command to execute (improve, fix-grammar, change-tone) */
  command: AiCommandType;
  /** The full block text with brackets around the selected portion */
  blockTextWithBrackets: string;
  /** Original selected text (without brackets) */
  selectedText: string;
  /** Additional context or options */
  options?: {
    tone?: 'formal' | 'casual' | 'professional' | 'friendly';
  };
}

export interface AiTransformResponse {
  /** Whether the transformation was successful */
  success: boolean;
  /** The transformed text with brackets around the modified portion */
  transformedBlockText?: string;
  /** Just the modified text (extracted from brackets) */
  modifiedText?: string;
  /** Error message if failed */
  error?: string;
}

export interface BlockInfo {
  /** The node representing the block */
  node: any;
  /** Start position of the block in the document */
  pos: number;
  /** Start position of content within the block */
  start: number;
  /** Full text content of the block */
  text: string;
  /** The block's node type name */
  type: string;
}

export interface SelectionInfo {
  /** Selected text */
  selectedText: string;
  /** Start position in document */
  from: number;
  /** End position in document */
  to: number;
  /** Offset from block start */
  offsetInBlock: number;
  /** Length of selection */
  length: number;
}

export interface AiProcessingState {
  /** Whether AI is currently processing */
  isProcessing: boolean;
  /** Current command being processed */
  currentCommand: AiCommandType | null;
  /** The block being processed */
  blockInfo: BlockInfo | null;
  /** The selection info */
  selectionInfo: SelectionInfo | null;
  /** Original block text (for rollback) */
  originalBlockText: string | null;
  /** Block text with brackets inserted */
  bracketedText: string | null;
  /** Transformed text from AI (with brackets) */
  transformedText: string | null;
  /** Error message if any */
  error: string | null;
}

