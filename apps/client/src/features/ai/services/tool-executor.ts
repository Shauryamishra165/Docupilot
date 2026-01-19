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
   * Simple fuzzy match function - checks if query characters appear in order in target
   * Similar to the fuzzy match used in slash menu
   */
  private fuzzyMatch(query: string, target: string): boolean {
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();
    let queryIndex = 0;
    
    for (const char of targetLower) {
      if (queryLower[queryIndex] === char) {
        queryIndex++;
        if (queryIndex === queryLower.length) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Calculate similarity score between two strings (0-1)
   * Simple implementation based on common characters
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;
    
    // Count common characters
    let common = 0;
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    
    for (let i = 0; i < minLen; i++) {
      if (s1[i] === s2[i]) common++;
    }
    
    // Also check if one contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
      return 0.8;
    }
    
    return common / maxLen;
  }

  /**
   * Find text in the document and return its range
   * Tries exact match first, then fuzzy match as fallback
   * Returns the first match, or null if not found
   */
  private findTextRange(
    searchText: string, 
    caseSensitive: boolean = false,
    useFuzzy: boolean = true
  ): { from: number; to: number } | null {
    try {
      console.log(`[ToolExecutor] findTextRange: Searching for "${searchText}" (caseSensitive: ${caseSensitive}, useFuzzy: ${useFuzzy})`);
      
      // First, try exact match using search-and-replace extension
      this.editor.commands.setSearchTerm(searchText);
      this.editor.commands.setCaseSensitive(caseSensitive);
      this.editor.commands.resetIndex();
      
      // Trigger state update to process search - dispatch empty transaction to force plugin update
      const { state, dispatch } = this.editor.view;
      const tr = state.tr;
      dispatch(tr);
      
      // Wait a bit for the search plugin to process (similar to findAndReplace)
      // Check results - the plugin should have processed by now
      let results = this.editor.storage?.searchAndReplace?.results || [];
      console.log(`[ToolExecutor] findTextRange: Initial results count: ${results.length}`);
      
      if (results.length === 0) {
        // Force another state update to ensure plugin processes
        const { state: currentState, dispatch: currentDispatch } = this.editor.view;
        const currentTr = currentState.tr;
        currentDispatch(currentTr);
        
        // Check again after state update
        results = this.editor.storage?.searchAndReplace?.results || [];
        console.log(`[ToolExecutor] findTextRange: Results after state update: ${results.length}`);
      }
      
      if (results.length > 0) {
        console.log(`[ToolExecutor] findTextRange: Found exact match at range ${results[0].from}-${results[0].to}`);
        // Return first exact match
        return results[0];
      }
      
      // If search plugin didn't find results, try direct document search as fallback
      console.log(`[ToolExecutor] findTextRange: Search plugin returned no results, trying direct document search...`);
      const { doc } = state;
      const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
      let directMatch: { from: number; to: number } | null = null;
      
      console.log(`[ToolExecutor] findTextRange: Searching for "${searchText}" (lowercase: "${searchLower}") in document...`);
      console.log(`[ToolExecutor] findTextRange: Document text content length: ${doc.textContent.length}`);
      console.log(`[ToolExecutor] findTextRange: Document text preview: "${doc.textContent.substring(0, 200)}..."`);
      
      // Direct search through document
      doc.descendants((node, pos) => {
        if (node.isText && !directMatch) {
          const nodeText = node.text || '';
          const searchInText = caseSensitive ? nodeText : nodeText.toLowerCase();
          const index = searchInText.indexOf(searchLower);
          
          if (index !== -1) {
            directMatch = {
              from: pos + index,
              to: pos + index + searchText.length,
            };
            console.log(`[ToolExecutor] findTextRange: Found direct match!`);
            console.log(`[ToolExecutor] findTextRange: Node text: "${nodeText}"`);
            console.log(`[ToolExecutor] findTextRange: Match at position ${index} in node at ${pos}`);
            console.log(`[ToolExecutor] findTextRange: Final range: ${directMatch.from}-${directMatch.to}`);
          }
        }
      });
      
      if (directMatch) {
        return directMatch;
      } else {
        console.warn(`[ToolExecutor] findTextRange: Direct search also found no match for "${searchText}"`);
      }
      
      // If no exact match and fuzzy search is enabled, try fuzzy matching
      if (useFuzzy && searchText.trim().length > 0) {
        console.log(`[ToolExecutor] No exact match found for "${searchText}", trying fuzzy search...`);
        const searchLower = searchText.toLowerCase();
        const candidates: Array<{ range: { from: number; to: number }; score: number }> = [];
        
        // Walk through all text nodes and find fuzzy matches
        doc.descendants((node, pos) => {
          if (node.isText) {
            const nodeText = node.text || '';
            const nodeTextLower = node.textContent.toLowerCase();
            
            // Check if fuzzy match
            if (this.fuzzyMatch(searchText, nodeTextLower)) {
              // Try to find the best substring match
              let bestScore = 0;
              let bestStart = 0;
              let bestEnd = 0;
              
              // Check all possible substrings
              for (let i = 0; i <= nodeTextLower.length - searchText.length; i++) {
                const substring = nodeTextLower.substring(i, i + searchText.length);
                const score = this.calculateSimilarity(searchText, substring);
                
                if (score > bestScore) {
                  bestScore = score;
                  bestStart = i;
                  bestEnd = i + searchText.length;
                }
              }
              
              // Also check if the search text is contained in this node
              if (nodeTextLower.includes(searchLower)) {
                const startIndex = nodeTextLower.indexOf(searchLower);
                const endIndex = startIndex + searchLower.length;
                const score = this.calculateSimilarity(searchText, nodeTextLower.substring(startIndex, endIndex));
                
                if (score > bestScore) {
                  bestScore = score;
                  bestStart = startIndex;
                  bestEnd = endIndex;
                }
              }
              
              if (bestScore > 0.3) { // Threshold for fuzzy match
                candidates.push({
                  range: {
                    from: pos + bestStart,
                    to: pos + bestEnd,
                  },
                  score: bestScore,
                });
              }
            }
          }
        });
        
        // Sort by score and return best match
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.score - a.score);
          console.log(`[ToolExecutor] Found ${candidates.length} fuzzy match(es), using best match with score ${candidates[0].score.toFixed(2)}`);
          return candidates[0].range;
        }
      }
      
      console.warn(`[ToolExecutor] No match found for text: "${searchText}"`);
      return null;
    } catch (error) {
      console.error('[ToolExecutor] Error finding text range:', error);
      return null;
    }
  }

  /**
   * Find a block by text/keywords and return its range
   * Useful for block-level operations like deletion (for future use)
   */
  private findBlockByText(
    searchText: string,
    useFuzzy: boolean = true
  ): { from: number; to: number; blockType: string } | null {
    try {
      const { state } = this.editor;
      const { doc } = state;
      
      const searchLower = searchText.toLowerCase();
      const candidates: Array<{ 
        range: { from: number; to: number }; 
        blockType: string;
        score: number;
        text: string;
      }> = [];
      
      // Walk through document to find blocks
      doc.descendants((node, pos) => {
        // Check if it's a block-level node
        if (node.isBlock && !node.isText) {
          const blockText = node.textContent.toLowerCase();
          
          // Try exact match first
          if (blockText.includes(searchLower)) {
            const startIndex = blockText.indexOf(searchLower);
            const endIndex = startIndex + searchLower.length;
            
            // Calculate actual positions within the block
            const blockStart = pos + 1; // +1 to skip block node start
            const blockEnd = pos + node.nodeSize - 1; // -1 to skip block node end
            
            candidates.push({
              range: {
                from: blockStart + startIndex,
                to: blockStart + endIndex,
              },
              blockType: node.type.name,
              score: 1.0,
              text: node.textContent,
            });
          } 
          // Try fuzzy match if enabled
          else if (useFuzzy && this.fuzzyMatch(searchText, blockText)) {
            const score = this.calculateSimilarity(searchText, blockText);
            
            if (score > 0.3) {
              const blockStart = pos + 1;
              const blockEnd = pos + node.nodeSize - 1;
              
              candidates.push({
                range: {
                  from: blockStart,
                  to: blockEnd,
                },
                blockType: node.type.name,
                score: score,
                text: node.textContent,
              });
            }
          }
        }
      });
      
      // Sort by score and return best match
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        console.log(`[ToolExecutor] Found block "${candidates[0].blockType}" with text: "${candidates[0].text.substring(0, 50)}..."`);
        return {
          from: candidates[0].range.from,
          to: candidates[0].range.to,
          blockType: candidates[0].blockType,
        };
      }
      
      return null;
    } catch (error) {
      console.error('[ToolExecutor] Error finding block by text:', error);
      return null;
    }
  }

  /**
   * Get range from either text or range parameter
   * Supports fuzzy search fallback
   */
  private getRangeFromParams(params: { 
    text?: string; 
    range?: { from: number; to: number };
    useFuzzy?: boolean;
  }): { from: number; to: number } | null {
    // If range is provided, use it directly
    if (params.range) {
      return params.range;
    }
    
    // If text is provided, find it (with fuzzy fallback)
    if (params.text) {
      return this.findTextRange(params.text, false, params.useFuzzy !== false);
    }
    
    // If neither provided, return null (will use current selection)
    return null;
  }

  /**
   * Apply formatting (marks) to text in the document
   * Now supports text parameter with fuzzy search fallback
   */
  private applyFormatting(params: ApplyFormattingTool['params']): boolean {
    const { format, range, text, attrs, useFuzzy } = params;

    console.log(`[ToolExecutor] applyFormatting: format=${format}, text="${text}", range=${range ? `${range.from}-${range.to}` : 'none'}, useFuzzy=${useFuzzy}`);

    if (!format) {
      console.warn('[ToolExecutor] applyFormatting: Format is required');
      return false;
    }

    try {
      // Get range from either text or range parameter
      const targetRange = this.getRangeFromParams({ text, range, useFuzzy });
      
      if (!targetRange) {
        console.warn('[ToolExecutor] applyFormatting: No range found and no current selection');
        // If no range and no selection, try to apply format anyway (will affect next typed text)
        // But this is not ideal, so return false
        return false;
      }
      
      const { from, to } = targetRange;
      if (from >= to) {
        console.warn('[ToolExecutor] applyFormatting: Invalid range, from must be less than to');
        return false;
      }
      
      console.log(`[ToolExecutor] applyFormatting: Setting selection to ${from}-${to}`);
      
      // First, set the text selection
      const selectionSet = this.editor.commands.setTextSelection({ from, to });
      if (!selectionSet) {
        console.warn('[ToolExecutor] applyFormatting: Failed to set text selection');
        return false;
      }
      
      // Verify selection was set correctly
      const { state } = this.editor.view;
      const currentSelection = state.selection;
      console.log(`[ToolExecutor] applyFormatting: Current selection after setTextSelection: ${currentSelection.from}-${currentSelection.to}`);
      
      if (currentSelection.from !== from || currentSelection.to !== to) {
        console.warn(`[ToolExecutor] applyFormatting: Selection mismatch! Expected ${from}-${to}, got ${currentSelection.from}-${currentSelection.to}`);
        // Try using focus and then setTextSelection again
        this.editor.commands.focus();
        const retrySelection = this.editor.commands.setTextSelection({ from, to });
        if (!retrySelection) {
          console.error('[ToolExecutor] applyFormatting: Failed to set selection on retry');
          return false;
        }
      }
      
      // Apply formatting based on type
      let success = false;
      switch (format) {
        case 'bold':
          success = this.editor.commands.setMark('bold');
          break;
        case 'italic':
          success = this.editor.commands.setMark('italic');
          break;
        case 'underline':
          success = this.editor.commands.setMark('underline');
          break;
        case 'strike':
          success = this.editor.commands.setMark('strike');
          break;
        case 'code':
          success = this.editor.commands.setMark('code');
          break;
        case 'link':
          if (!attrs?.href) {
            console.warn('[ToolExecutor] applyFormatting: href is required for link format');
            return false;
          }
          success = this.editor.commands.setLink({ href: attrs.href });
          break;
        default:
          console.warn('[ToolExecutor] applyFormatting: Unknown format:', format);
          return false;
      }
      
      console.log(`[ToolExecutor] applyFormatting: Format "${format}" applied: ${success}`);
      
      // Verify the mark was actually applied
      if (success && format !== 'link') {
        const finalState = this.editor.view.state;
        const markType = finalState.schema.marks[format];
        if (markType) {
          const hasMark = markType.isInSet(finalState.selection.$from.marks());
          console.log(`[ToolExecutor] applyFormatting: Mark "${format}" is in set: ${hasMark}`);
        }
      }
      
      return success;
    } catch (error) {
      console.error('[ToolExecutor] Error applying formatting:', error);
      return false;
    }
  }

  /**
   * Clear all formatting (marks) from text in the document
   * Now supports text parameter with fuzzy search fallback
   */
  private clearFormatting(params: ClearFormattingTool['params']): boolean {
    const { range, text, useFuzzy } = params;

    try {
      // Get range from either text or range parameter
      const targetRange = this.getRangeFromParams({ text, range, useFuzzy });
      
      if (targetRange) {
        const { from, to } = targetRange;
        if (from >= to) {
          console.warn('[ToolExecutor] clearFormatting: Invalid range, from must be less than to');
          return false;
        }
        this.editor.commands.setTextSelection({ from, to });
      }

      // Clear all marks from the selection
      const { state, dispatch } = this.editor.view;
      const { from, to } = state.selection;

      if (from === to) {
        console.warn('[ToolExecutor] clearFormatting: No selection to clear formatting from');
        return false;
      }

      const tr = state.tr;
      
      // Remove all marks from the selected range
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isText && node.marks.length > 0) {
          const nodeFrom = Math.max(from, pos);
          const nodeTo = Math.min(to, pos + node.nodeSize);
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

