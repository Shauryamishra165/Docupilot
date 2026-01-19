/**
 * AI Transform Service
 * 
 * Orchestrates the AI text transformation process:
 * 1. Extract block and selection info
 * 2. Insert brackets around selected text
 * 3. Convert to markdown format
 * 4. Send to AI service
 * 5. Process response and replace text
 */

import { Editor } from '@tiptap/react';
import api from '@/lib/api-client';
import { AiCommandType, AiTransformRequest, AiTransformResponse, BlockInfo, SelectionInfo } from './types';
import {
  insertBrackets,
  extractBracketedText,
  removeBrackets,
  replaceBracketedContent,
  bracketedToMarkdownMarkers,
  markdownMarkersToBracketed,
  MD_BRACKET_START,
  MD_BRACKET_END,
} from './bracket-utils';
import {
  getBlockAndSelectionInfo,
  blockToMarkdown,
  replaceSelection,
} from './block-utils';

export interface TransformOptions {
  tone?: 'formal' | 'casual' | 'professional' | 'friendly';
}

export class AiTransformService {
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /**
   * Execute an AI text transformation command
   */
  async executeCommand(
    command: AiCommandType,
    options?: TransformOptions
  ): Promise<{
    success: boolean;
    originalText: string;
    modifiedText?: string;
    error?: string;
  }> {
    try {
      // Step 1: Get block and selection info
      const info = getBlockAndSelectionInfo(this.editor);
      if (!info) {
        return {
          success: false,
          originalText: '',
          error: 'No text selected or unable to find parent block',
        };
      }

      const { block, selection } = info;
      console.log('[AiTransformService] Block info:', block);
      console.log('[AiTransformService] Selection info:', selection);

      // Step 2: Insert brackets around the selected text
      const bracketedBlockText = insertBrackets(
        block.text,
        selection.offsetInBlock,
        selection.offsetInBlock + selection.length,
        true // Use markdown markers for sending to AI
      );
      console.log('[AiTransformService] Bracketed text:', bracketedBlockText);

      // Step 3: Convert to markdown format with block context
      const markdownText = this.convertToMarkdownWithContext(block, bracketedBlockText);
      console.log('[AiTransformService] Markdown for AI:', markdownText);

      // Step 4: Send to AI service
      const response = await this.sendToAiService(command, markdownText, selection.selectedText, options);
      console.log('[AiTransformService] AI response:', response);

      if (!response.success || !response.transformedBlockText) {
        return {
          success: false,
          originalText: selection.selectedText,
          error: response.error || 'AI transformation failed',
        };
      }

      // Step 5: Extract the modified text from brackets
      const modifiedText = extractBracketedText(response.transformedBlockText, true);
      if (!modifiedText) {
        return {
          success: false,
          originalText: selection.selectedText,
          error: 'Could not extract modified text from AI response',
        };
      }

      console.log('[AiTransformService] Modified text:', modifiedText);

      // Step 6: Replace the selected text with the modified text
      const replaced = replaceSelection(this.editor, selection, modifiedText);
      if (!replaced) {
        return {
          success: false,
          originalText: selection.selectedText,
          modifiedText,
          error: 'Failed to apply changes to the document',
        };
      }

      return {
        success: true,
        originalText: selection.selectedText,
        modifiedText,
      };
    } catch (error) {
      console.error('[AiTransformService] Error:', error);
      return {
        success: false,
        originalText: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Convert the block to markdown with context, preserving bracket markers
   */
  private convertToMarkdownWithContext(block: BlockInfo, bracketedText: string): string {
    // For now, we create a simple markdown representation
    // The block type determines the markdown formatting
    const { type } = block;

    switch (type) {
      case 'heading':
        const level = block.node.attrs?.level || 1;
        const prefix = '#'.repeat(level);
        return `${prefix} ${bracketedText}`;

      case 'codeBlock':
        const language = block.node.attrs?.language || '';
        return `\`\`\`${language}\n${bracketedText}\n\`\`\``;

      case 'blockquote':
        return `> ${bracketedText}`;

      case 'listItem':
        return `- ${bracketedText}`;

      case 'taskItem':
        const checked = block.node.attrs?.checked ? 'x' : ' ';
        return `- [${checked}] ${bracketedText}`;

      case 'paragraph':
      default:
        return bracketedText;
    }
  }

  /**
   * Send the text to the AI service for transformation
   */
  private async sendToAiService(
    command: AiCommandType,
    blockTextWithBrackets: string,
    selectedText: string,
    options?: TransformOptions
  ): Promise<AiTransformResponse> {
    try {
      const request: AiTransformRequest = {
        command,
        blockTextWithBrackets,
        selectedText,
        options,
      };

      // Call the backend AI text transform endpoint
      const response = await api.post<AiTransformResponse>(
        '/external-service/ai/text-transform',
        request
      );

      return response.data;
    } catch (error) {
      console.error('[AiTransformService] API error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'API request failed',
      };
    }
  }

  /**
   * Get the command description for prompting
   */
  static getCommandPrompt(command: AiCommandType, options?: TransformOptions): string {
    switch (command) {
      case 'improve':
        return 'Improve the writing quality, clarity, and flow of the text within the brackets. Make it more professional and polished while preserving the original meaning.';

      case 'fix-grammar':
        return 'Fix all grammar, spelling, and punctuation errors in the text within the brackets. Preserve the original meaning and tone.';

      case 'change-tone':
        const tone = options?.tone || 'professional';
        return `Change the tone of the text within the brackets to be more ${tone}. Preserve the original meaning while adjusting the style and word choice.`;

      default:
        return 'Improve the text within the brackets.';
    }
  }
}

