/**
 * Tool Executor Service
 * 
 * Converts AI tool calls into ProseMirror editor commands.
 * This adapter layer runs in the frontend where the live editor instance exists.
 */

import { Editor } from '@tiptap/react';
import {
  AiToolCall,
  InsertContentTool,
  ReplaceContentTool,
  DeleteContentTool,
  FormatTextTool,
  InsertBlockTool,
} from '../types/ai-tools.types';

export class ToolExecutor {
  constructor(private editor: Editor) {
    if (!editor) {
      throw new Error('ToolExecutor requires an editor instance');
    }
  }

  /**
   * Execute a tool call from the AI service
   * Returns true if successful, false otherwise
   */
  execute(toolCall: AiToolCall): boolean {
    try {
      switch (toolCall.tool) {
        case 'insert_content':
          return this.insertContent(toolCall.params);
        case 'replace_content':
          return this.replaceContent(toolCall.params);
        case 'delete_content':
          return this.deleteContent(toolCall.params);
        case 'format_text':
          return this.formatText(toolCall.params);
        case 'insert_block':
          return this.insertBlock(toolCall.params);
        default:
          console.warn('[ToolExecutor] Unknown tool:', toolCall);
          return false;
      }
    } catch (error) {
      console.error('[ToolExecutor] Error executing tool:', toolCall, error);
      return false;
    }
  }

  /**
   * Execute multiple tool calls in sequence
   */
  executeMultiple(toolCalls: AiToolCall[]): boolean[] {
    return toolCalls.map((toolCall) => this.execute(toolCall));
  }

  /**
   * Insert content at a specified position
   */
  private insertContent(params: InsertContentTool['params']): boolean {
    const { content, position = 'cursor' } = params; // Default to 'cursor' if position not provided

    if (!content || content.trim().length === 0) {
      console.warn('[ToolExecutor] insertContent: Empty content provided');
      return false;
    }

    try {
      switch (position) {
        case 'start':
          // Move cursor to start, insert content
          this.editor.commands.focus('start');
          return this.editor.commands.insertContent(content);

        case 'end':
          // Move cursor to end, insert content
          this.editor.commands.focus('end');
          return this.editor.commands.insertContent(content);

        case 'cursor':
          // Insert at current cursor position
          return this.editor.commands.insertContent(content);

        case 'after_selection':
          // Move to end of selection, insert content
          const { to } = this.editor.state.selection;
          this.editor.commands.setTextSelection(to);
          return this.editor.commands.insertContent(content);

        default:
          console.warn('[ToolExecutor] Unknown insert position:', position, '- defaulting to cursor');
          // Insert at current cursor position
          return this.editor.commands.insertContent(content);
      }
    } catch (error) {
      console.error('[ToolExecutor] Error inserting content:', error);
      return false;
    }
  }

  /**
   * Replace content in the document
   */
  private replaceContent(params: ReplaceContentTool['params']): boolean {
    const { content, target } = params;

    if (target === 'all') {
      // Replace entire document
      return this.editor.commands.setContent(content);
    }

    if (target === 'selection') {
      // Delete selection, insert new content
      this.editor.commands.deleteSelection();
      return this.editor.commands.insertContent(content);
    }

    return false;
  }

  /**
   * Delete content from the document
   */
  private deleteContent(params: DeleteContentTool['params']): boolean {
    const { target } = params;

    if (target === 'all') {
      // Clear entire document
      return this.editor.commands.clearContent();
    }

    if (target === 'selection') {
      // Delete selected content
      return this.editor.commands.deleteSelection();
    }

    return false;
  }

  /**
   * Format text in the document
   */
  private formatText(params: FormatTextTool['params']): boolean {
    const { format, target } = params;

    // If no selection and target is 'word', we can apply formatting which will affect
    // text typed after the cursor, or we can skip formatting if selection is required
    // For now, if there's no selection, we'll just apply the format toggle
    // which will enable the format for subsequent typing

    // Apply formatting based on type
    switch (format) {
      case 'bold':
        return this.editor.commands.toggleBold();
      case 'italic':
        return this.editor.commands.toggleItalic();
      case 'underline':
        return this.editor.commands.toggleUnderline();
      case 'strikethrough':
        return this.editor.commands.toggleStrike();
      case 'code':
        return this.editor.commands.toggleCode();
      default:
        console.warn('[ToolExecutor] Unknown format:', format);
        return false;
    }
  }

  /**
   * Insert a block element (heading, paragraph, code block, etc.)
   */
  private insertBlock(params: InsertBlockTool['params']): boolean {
    const { type, content, attrs, position } = params;

    // Position cursor
    if (position === 'start') {
      this.editor.commands.focus('start');
    } else if (position === 'end') {
      this.editor.commands.focus('end');
    }

    // Insert block based on type
    switch (type) {
      case 'heading':
        return this.editor.chain()
          .insertContent({
            type: 'heading',
            attrs: { level: attrs?.level || 2 },
            content: [{ type: 'text', text: content }],
          })
          .run();

      case 'paragraph':
        return this.editor.commands.insertContent(`<p>${content}</p>`);

      case 'code_block':
        return this.editor.chain()
          .insertContent({
            type: 'codeBlock',
            attrs: { language: attrs?.language || 'text' },
            content: [{ type: 'text', text: content }],
          })
          .run();

      case 'callout':
        return this.editor.commands.insertContent({
          type: 'callout',
          attrs: { type: attrs?.calloutType || 'info' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: content }],
            },
          ],
        });

      case 'list':
        // For lists, we insert as HTML which Tiptap will parse
        const listType = attrs?.ordered ? 'ol' : 'ul';
        return this.editor.commands.insertContent(`<${listType}><li>${content}</li></${listType}>`);

      default:
        // Fallback to plain paragraph
        return this.editor.commands.insertContent(content);
    }
  }
}

