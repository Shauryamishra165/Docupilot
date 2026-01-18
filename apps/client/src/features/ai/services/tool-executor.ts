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
  FindAndReplaceTool,
  ApplyFormattingTool,
  ClearFormattingTool,
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
        case 'find_and_replace':
          return this.findAndReplace(toolCall.params);
        case 'apply_formatting':
          return this.applyFormatting(toolCall.params);
        case 'clear_formatting':
          return this.clearFormatting(toolCall.params);
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

  /**
   * Find and replace text in the document
   */
  private findAndReplace(params: FindAndReplaceTool['params']): boolean {
    const { searchText, replaceText, replaceAll = true, caseSensitive = false } = params; // Default replaceAll to true

    if (!searchText || searchText.trim().length === 0) {
      console.warn('[ToolExecutor] findAndReplace: Empty search text provided');
      return false;
    }

    if (replaceText === undefined || replaceText === null) {
      console.warn('[ToolExecutor] findAndReplace: Replace text is required');
      return false;
    }

    try {
      // Set search term (updates storage)
      this.editor.commands.setSearchTerm(searchText);
      
      // Set case sensitivity
      this.editor.commands.setCaseSensitive(caseSensitive);
      
      // Reset index to start from beginning
      this.editor.commands.resetIndex();
      
      // Set replace term
      this.editor.commands.setReplaceTerm(replaceText);
      
      // Trigger a state update by dispatching an empty transaction
      // This ensures the search plugin's apply() method runs and populates results
      const { state, dispatch } = this.editor.view;
      const tr = state.tr;
      dispatch(tr);
      
      // Now check for results (plugin should have processed by now)
      const results = this.editor.storage?.searchAndReplace?.results || [];
      
      if (results.length === 0) {
        console.warn('[ToolExecutor] findAndReplace: No matches found for search text:', searchText);
        // Try again after a brief delay in case plugin needs more time
        setTimeout(() => {
          const retryResults = this.editor.storage?.searchAndReplace?.results || [];
          if (retryResults.length > 0) {
            if (replaceAll) {
              this.editor.commands.replaceAll();
            } else {
              this.editor.commands.replace();
            }
          }
        }, 10);
        return false;
      }
      
      console.log(`[ToolExecutor] findAndReplace: Found ${results.length} match(es) for "${searchText}"`);
      
      if (replaceAll) {
        // Replace all matches
        const success = this.editor.commands.replaceAll();
        if (success) {
          console.log(`[ToolExecutor] findAndReplace: Successfully replaced ${results.length} occurrence(s)`);
        } else {
          console.warn('[ToolExecutor] findAndReplace: replaceAll() returned false');
        }
        return success;
      } else {
        // Replace current match (at resultIndex 0 after reset)
        const success = this.editor.commands.replace();
        if (success) {
          console.log('[ToolExecutor] findAndReplace: Successfully replaced 1 occurrence');
        } else {
          console.warn('[ToolExecutor] findAndReplace: replace() returned false');
        }
        return success;
      }
    } catch (error) {
      console.error('[ToolExecutor] Error in find and replace:', error);
      return false;
    }
  }

  /**
   * Apply formatting (marks) to text in the document
   */
  private applyFormatting(params: ApplyFormattingTool['params']): boolean {
    const { format, range, attrs } = params;

    if (!format) {
      console.warn('[ToolExecutor] applyFormatting: Format is required');
      return false;
    }

    try {
      // If range is provided, set text selection to that range
      if (range) {
        const { from, to } = range;
        if (from >= to) {
          console.warn('[ToolExecutor] applyFormatting: Invalid range, from must be less than to');
          return false;
        }
        this.editor.commands.setTextSelection({ from, to });
      }

      // Apply formatting based on type
      switch (format) {
        case 'bold':
          return this.editor.commands.setMark('bold');
        case 'italic':
          return this.editor.commands.setMark('italic');
        case 'underline':
          return this.editor.commands.setMark('underline');
        case 'strike':
          return this.editor.commands.setMark('strike');
        case 'code':
          return this.editor.commands.setMark('code');
        case 'link':
          if (!attrs?.href) {
            console.warn('[ToolExecutor] applyFormatting: href is required for link format');
            return false;
          }
          return this.editor.commands.setLink({ href: attrs.href });
        default:
          console.warn('[ToolExecutor] applyFormatting: Unknown format:', format);
          return false;
      }
    } catch (error) {
      console.error('[ToolExecutor] Error applying formatting:', error);
      return false;
    }
  }

  /**
   * Clear all formatting (marks) from text in the document
   */
  private clearFormatting(params: ClearFormattingTool['params']): boolean {
    const { range } = params;

    try {
      // If range is provided, set text selection to that range
      if (range) {
        const { from, to } = range;
        if (from >= to) {
          console.warn('[ToolExecutor] clearFormatting: Invalid range, from must be less than to');
          return false;
        }
        this.editor.commands.setTextSelection({ from, to });
      }

      // Clear all marks from the selection
      // Use unsetAllMarks command if available, otherwise manually remove marks
      const { state, dispatch } = this.editor.view;
      const { from, to } = state.selection;

      if (from === to) {
        // No selection, nothing to clear
        console.warn('[ToolExecutor] clearFormatting: No selection to clear formatting from');
        return false;
      }

      const tr = state.tr;
      
      // Remove all marks from the selected range
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isText && node.marks.length > 0) {
          const nodeFrom = Math.max(from, pos);
          const nodeTo = Math.min(to, pos + node.nodeSize);
          // Remove all marks from this text node
          node.marks.forEach(mark => {
            tr.removeMark(nodeFrom, nodeTo, mark.type);
          });
        }
      });

      if (dispatch) {
        dispatch(tr);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[ToolExecutor] Error clearing formatting:', error);
      return false;
    }
  }
}

