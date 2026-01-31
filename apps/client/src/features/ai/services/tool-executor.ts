/**
 * Tool Executor Service
 * 
 * Converts AI tool calls into ProseMirror editor commands.
 * This adapter layer runs in the frontend where the live editor instance exists.
 */

import { Editor } from '@tiptap/react';
import { markdownToHtml } from '@docmost/editor-ext';
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
  InsertAfterSectionTool,
  TableEditTool,
} from '../types/ai-tools.types';

/**
 * Convert markdown content to HTML for proper editor rendering
 */
function convertMarkdownToHtml(content: string): string {
  try {
    // Check if content looks like markdown (has markdown syntax)
    const hasMarkdownSyntax = /[#*_`\[\]!]/.test(content) || content.includes('\n');
    if (hasMarkdownSyntax) {
      const html = markdownToHtml(content);
      return html as string;
    }
    return content;
  } catch (error) {
    console.warn('[ToolExecutor] Markdown conversion failed, using plain text:', error);
    return content;
  }
}

export class ToolExecutor {
  private changeListeners: Array<(change: any) => void> = [];
  private previewMode: boolean = false;
  private inlineTrackingEnabled: boolean = false;
  private pendingChanges: Array<{
    id: string;
    toolCall: AiToolCall;
    applied: boolean;
  }> = [];

  constructor(private editor: Editor) {
    if (!editor) {
      throw new Error('ToolExecutor requires an editor instance');
    }
  }

  /**
   * Enable or disable preview mode
   * In preview mode, changes are tracked but not applied until confirmed
   */
  setPreviewMode(enabled: boolean): void {
    this.previewMode = enabled;
  }

  /**
   * Enable or disable inline change tracking
   * When enabled, changes are shown inline in the editor with accept/reject buttons
   */
  setInlineTracking(enabled: boolean): void {
    this.inlineTrackingEnabled = enabled;
  }

  /**
   * Check if inline tracking is enabled
   */
  isInlineTrackingEnabled(): boolean {
    return this.inlineTrackingEnabled;
  }

  /**
   * Register a listener for change notifications
   */
  onChangeProposed(listener: (change: any) => void): void {
    this.changeListeners.push(listener);
  }

  /**
   * Remove a change listener
   */
  removeChangeListener(listener: (change: any) => void): void {
    this.changeListeners = this.changeListeners.filter(l => l !== listener);
  }

  /**
   * Notify all listeners about a proposed change
   */
  private notifyChange(change: any): void {
    this.changeListeners.forEach(listener => listener(change));
  }

  /**
   * Apply a pending change by ID
   */
  applyChange(changeId: string): boolean {
    const pending = this.pendingChanges.find(c => c.id === changeId);
    if (!pending || pending.applied) {
      return false;
    }

    const success = this.executeInternal(pending.toolCall);
    if (success) {
      pending.applied = true;
    }
    return success;
  }

  /**
   * Reject a pending change by ID
   */
  rejectChange(changeId: string): void {
    this.pendingChanges = this.pendingChanges.filter(c => c.id !== changeId);
  }

  /**
   * Execute a tool call from the AI service
   * Returns true if successful, false otherwise
   */
  execute(toolCall: AiToolCall): boolean {
    console.log('[ToolExecutor] Executing tool call:', toolCall.tool, 
      'previewMode:', this.previewMode, 
      'inlineTracking:', this.inlineTrackingEnabled);

    if (this.inlineTrackingEnabled) {
      // In inline tracking mode, create inline changes in the editor
      return this.createInlineChange(toolCall);
    } else if (this.previewMode) {
      // In preview mode, track the change and notify listeners (sidebar mode)
      const changeId = `change_${Date.now()}_${Math.random()}`;
      
      const change = {
        id: changeId,
        type: this.getChangeType(toolCall),
        description: this.getChangeDescription(toolCall),
        toolCall: toolCall,
        status: 'pending' as const,
      };

      this.pendingChanges.push({
        id: changeId,
        toolCall: toolCall,
        applied: false,
      });

      this.notifyChange(change);
      return true;
    } else {
      // In direct mode, execute immediately
      return this.executeInternal(toolCall);
    }
  }

  /**
   * Create an inline change in the editor using the ChangeTrackingExtension
   * Changes are APPLIED immediately, with accept/reject buttons for undo
   */
  private createInlineChange(toolCall: AiToolCall): boolean {
    try {
      // Special handling for tools that don't support inline tracking
      // These execute directly without position tracking
      if (toolCall.tool === 'table_edit') {
        console.log('[ToolExecutor] table_edit - executing directly (no inline tracking)');
        return this.executeInternal(toolCall);
      }
      
      if (toolCall.tool === 'insert_after_section') {
        console.log('[ToolExecutor] insert_after_section - executing directly (semantic insertion)');
        return this.executeInternal(toolCall);
      }
      
      // Find positions where the change should apply
      const positions = this.findChangePositions(toolCall);
      
      if (positions.length === 0) {
        console.warn('[ToolExecutor] No positions found for inline change');
        // Fall back to direct execution
        return this.executeInternal(toolCall);
      }

      console.log('[ToolExecutor] Found', positions.length, 'position(s) for inline change');

      // Check if ChangeTrackingExtension is available
      const editorCommands = this.editor.commands as any;
      if (typeof editorCommands.applyTrackedChange !== 'function') {
        console.warn('[ToolExecutor] ChangeTrackingExtension not available, falling back to direct execution');
        return this.executeInternal(toolCall);
      }

      // For multiple positions, execute directly without tracking
      // (tracking multiple positions is problematic because positions shift)
      if (positions.length > 1) {
        console.log('[ToolExecutor] Multiple positions detected, using direct execution for reliability');
        return this.executeInternal(toolCall);
      }

      // Single position - use change tracking
      const { from, to, newContent } = positions[0];
      const changeType = this.getChangeType(toolCall);
      
      // Determine the type for applyTrackedChange
      let type: 'insert' | 'delete' | 'replace' = 'replace';
      if (changeType === 'insert') {
        type = from === to ? 'insert' : 'replace';
      } else if (changeType === 'delete') {
        type = 'delete';
      } else {
        type = 'replace';
      }
      
      // Apply the change with tracking
      const success = editorCommands.applyTrackedChange({
        type,
        from,
        to,
        newContent,
      });
      
      console.log('[ToolExecutor] Applied single tracked change:', type, 'at', from, '-', to, 'success:', success);

      return success;
    } catch (error) {
      console.error('[ToolExecutor] Error creating inline change:', error);
      // Fall back to direct execution
      return this.executeInternal(toolCall);
    }
  }

  /**
   * Find positions in the document where the change should apply
   */
  private findChangePositions(toolCall: AiToolCall): Array<{ from: number; to: number; newContent: string }> {
    const positions: Array<{ from: number; to: number; newContent: string }> = [];

    if (toolCall.tool === 'find_and_replace') {
      const params = toolCall.params as FindAndReplaceTool['params'];
      const { searchText, replaceText, replaceAll = true, caseSensitive = false } = params;
      
      if (!searchText) return positions;

      const { doc } = this.editor.state;
      const regex = caseSensitive 
        ? new RegExp(this.escapeRegex(searchText), 'g')
        : new RegExp(this.escapeRegex(searchText), 'gi');

      // Search through the document
      doc.descendants((node, pos) => {
        if (node.isText && node.text) {
          let match;
          while ((match = regex.exec(node.text)) !== null) {
            positions.push({
              from: pos + match.index,
              to: pos + match.index + match[0].length,
              newContent: replaceText || '',
            });
            
            if (!replaceAll) break;
          }
          if (!replaceAll && positions.length > 0) return false;
        }
      });
    } else if (toolCall.tool === 'insert_content') {
      const params = toolCall.params as InsertContentTool['params'];
      const { content, position, contentType = 'markdown' } = params;
      
      let insertPos = 0;
      switch (position) {
        case 'start':
          insertPos = 0;
          break;
        case 'end':
          insertPos = this.editor.state.doc.content.size;
          break;
        case 'cursor':
        case 'after_selection':
        default:
          insertPos = this.editor.state.selection.to;
          break;
      }
      
      // Convert markdown to HTML if needed
      let processedContent = content || '';
      if (contentType === 'markdown' || contentType === 'text') {
        processedContent = convertMarkdownToHtml(processedContent);
      }
      
      positions.push({
        from: insertPos,
        to: insertPos,
        newContent: processedContent,
      });
    } else if (toolCall.tool === 'replace_content') {
      const params = toolCall.params as ReplaceContentTool['params'];
      const { content, target, contentType = 'markdown' } = params;
      
      // Convert markdown to HTML if needed
      let processedContent = content || '';
      if (contentType === 'markdown' || contentType === 'text') {
        processedContent = convertMarkdownToHtml(processedContent);
      }
      
      if (target === 'selection') {
        const { from, to } = this.editor.state.selection;
        positions.push({ from, to, newContent: processedContent });
      } else if (target === 'all') {
        positions.push({
          from: 0,
          to: this.editor.state.doc.content.size,
          newContent: processedContent,
        });
      }
    } else if (toolCall.tool === 'delete_content') {
      const params = toolCall.params as DeleteContentTool['params'];
      const { target } = params;
      
      if (target === 'selection') {
        const { from, to } = this.editor.state.selection;
        positions.push({ from, to, newContent: '' });
      }
    } else if (toolCall.tool === 'insert_after_section') {
      // Semantic insertion - find section and insert after it
      const params = toolCall.params as InsertAfterSectionTool['params'];
      const { content, sectionTitle } = params;
      
      if (sectionTitle && content) {
        const { doc } = this.editor.state;
        let insertPos = -1;
        
        // Find the section
        doc.descendants((node, pos) => {
          if (insertPos >= 0) return false;
          
          if (node.isBlock && node.textContent) {
            const nodeText = node.textContent.toLowerCase().trim();
            const searchText = sectionTitle.toLowerCase().trim();
            
            if (nodeText.includes(searchText) || searchText.includes(nodeText)) {
              insertPos = pos + node.nodeSize;
              return false;
            }
          }
        });
        
        if (insertPos < 0) {
          insertPos = doc.content.size;
        }
        
        positions.push({
          from: insertPos,
          to: insertPos,
          newContent: convertMarkdownToHtml(content),
        });
      }
    }

    return positions;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get change type from tool call
   */
  private getChangeType(toolCall: AiToolCall): "insert" | "replace" | "delete" | "format" {
    switch (toolCall.tool) {
      case 'insert_content':
      case 'insert_block':
        return 'insert';
      case 'replace_content':
      case 'find_and_replace':
        return 'replace';
      case 'delete_content':
        return 'delete';
      case 'apply_formatting':
      case 'clear_formatting':
      case 'format_text':
        return 'format';
      default:
        return 'replace';
    }
  }

  /**
   * Get human-readable description of the change
   */
  private getChangeDescription(toolCall: AiToolCall): string {
    switch (toolCall.tool) {
      case 'insert_content':
        return `Insert content at ${(toolCall.params as any).position || 'cursor'}`;
      case 'insert_block':
        return `Insert ${(toolCall.params as any).blockType} block`;
      case 'replace_content':
        return `Replace ${(toolCall.params as any).target === 'all' ? 'entire document' : 'selection'}`;
      case 'find_and_replace':
        const params = toolCall.params as any;
        return `Replace "${params.searchText}" with "${params.replaceText}"${params.replaceAll ? ' (all)' : ''}`;
      case 'format_text':
        return `Format text as ${(toolCall.params as any).format}`;
      case 'apply_formatting':
        return `Apply ${(toolCall.params as any).format} formatting`;
      case 'clear_formatting':
        return 'Clear formatting';
      case 'delete_content':
        return `Delete ${(toolCall.params as any).target}`;
      case 'insert_after_section':
        return `Insert after "${(toolCall.params as any).sectionTitle}"`;
      case 'table_edit':
        const tableParams = toolCall.params as any;
        return `Table: ${tableParams.action}${tableParams.rows ? ` (${tableParams.rows}x${tableParams.columns})` : ''}`;
      default:
        return `Execute ${(toolCall as any).tool}`;
    }
  }

  /**
   * Internal execution (actual tool execution)
   */
  private executeInternal(toolCall: AiToolCall): boolean {
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
        case 'insert_after_section':
          return this.insertAfterSection(toolCall.params);
        case 'table_edit':
          return this.tableEdit(toolCall.params);
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
   * Converts markdown to proper HTML for editor rendering
   */
  private insertContent(params: InsertContentTool['params']): boolean {
    const { content, position = 'cursor', contentType = 'markdown' } = params;

    if (!content || content.trim().length === 0) {
      console.warn('[ToolExecutor] insertContent: Empty content provided');
      return false;
    }

    try {
      // Convert markdown to HTML for proper editor rendering
      let insertableContent: string | { type: string; content: any };
      
      if (contentType === 'markdown' || contentType === 'text') {
        // Convert markdown to HTML
        const html = convertMarkdownToHtml(content);
        console.log('[ToolExecutor] Converted markdown to HTML:', html.substring(0, 100));
        insertableContent = html;
      } else {
        insertableContent = content;
      }

      switch (position) {
        case 'start':
          // Move cursor to start, insert content
          this.editor.commands.focus('start');
          return this.editor.commands.insertContent(insertableContent);

        case 'end':
          // Move cursor to end, insert content
          this.editor.commands.focus('end');
          return this.editor.commands.insertContent(insertableContent);

        case 'cursor':
          // Insert at current cursor position
          return this.editor.commands.insertContent(insertableContent);

        case 'after_selection':
          // Move to end of selection, insert content
          const { to } = this.editor.state.selection;
          this.editor.commands.setTextSelection(to);
          return this.editor.commands.insertContent(insertableContent);

        default:
          console.warn('[ToolExecutor] Unknown insert position:', position, '- defaulting to cursor');
          // Insert at current cursor position
          return this.editor.commands.insertContent(insertableContent);
      }
    } catch (error) {
      console.error('[ToolExecutor] Error inserting content:', error);
      return false;
    }
  }

  /**
   * Replace content in the document
   * Converts markdown to proper HTML for editor rendering
   */
  private replaceContent(params: ReplaceContentTool['params']): boolean {
    const { content, target, contentType = 'markdown' } = params;

    // Convert markdown to HTML for proper editor rendering
    let replacementContent = content;
    if (contentType === 'markdown' || contentType === 'text') {
      replacementContent = convertMarkdownToHtml(content);
      console.log('[ToolExecutor] Converted markdown for replace:', replacementContent.substring(0, 100));
    }

    if (target === 'all') {
      // Replace entire document - use setContent for full replacement
      return this.editor.commands.setContent(replacementContent);
    }

    if (target === 'selection') {
      // Delete selection, insert new content
      this.editor.commands.deleteSelection();
      return this.editor.commands.insertContent(replacementContent);
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

  /**
   * Insert content after a specific section/heading (Semantic Insertion)
   * Finds the section by title and inserts content after it
   */
  private insertAfterSection(params: InsertAfterSectionTool['params']): boolean {
    const { content, sectionTitle, contentType = 'markdown' } = params;

    if (!content || content.trim().length === 0) {
      console.warn('[ToolExecutor] insertAfterSection: Empty content provided');
      return false;
    }

    if (!sectionTitle || sectionTitle.trim().length === 0) {
      console.warn('[ToolExecutor] insertAfterSection: Empty section title provided');
      return false;
    }

    try {
      const { doc } = this.editor.state;
      let insertPosition = -1;
      let sectionFound = false;

      // Search for the section by title
      doc.descendants((node, pos) => {
        if (sectionFound) return false; // Stop if already found

        // Check headings and paragraphs for matching text
        if (node.isBlock && node.textContent) {
          const nodeText = node.textContent.toLowerCase().trim();
          const searchText = sectionTitle.toLowerCase().trim();
          
          // Check for exact or partial match
          if (nodeText.includes(searchText) || searchText.includes(nodeText)) {
            // Insert after this node
            insertPosition = pos + node.nodeSize;
            sectionFound = true;
            console.log('[ToolExecutor] Found section at position:', pos, 'Insert at:', insertPosition);
            return false;
          }
        }
      });

      if (!sectionFound || insertPosition < 0) {
        console.warn('[ToolExecutor] insertAfterSection: Section not found:', sectionTitle);
        // Fallback to end of document
        insertPosition = doc.content.size;
        console.log('[ToolExecutor] Falling back to end position:', insertPosition);
      }

      // Convert markdown to HTML
      let insertableContent = content;
      if (contentType === 'markdown' || contentType === 'text') {
        insertableContent = convertMarkdownToHtml(content);
      }

      console.log('[ToolExecutor] insertAfterSection: Inserting at position', insertPosition);
      console.log('[ToolExecutor] insertAfterSection: Content preview:', insertableContent.substring(0, 100));

      // Move cursor to position and insert using chain
      return this.editor
        .chain()
        .focus()
        .setTextSelection(insertPosition)
        .insertContent(insertableContent)
        .run();
    } catch (error) {
      console.error('[ToolExecutor] Error in insertAfterSection:', error);
      return false;
    }
  }

  /**
   * Edit tables in the document
   */
  private tableEdit(params: TableEditTool['params']): boolean {
    const { action, tableIndex = 0, rowIndex, columnIndex, content, rows = 3, columns = 3 } = params;

    try {
      console.log('[ToolExecutor] tableEdit:', action, { tableIndex, rowIndex, columnIndex, rows, columns });
      
      switch (action) {
        case 'create_table':
          // Create a new table with specified dimensions using chain
          console.log('[ToolExecutor] Creating table with', rows, 'rows and', columns, 'columns');
          return this.editor
            .chain()
            .focus()
            .insertTable({ rows, cols: columns, withHeaderRow: true })
            .run();

        case 'add_row':
          // Find and focus the table, then add row
          if (this.focusTable(tableIndex)) {
            return this.editor.chain().focus().addRowAfter().run();
          }
          console.warn('[ToolExecutor] Could not focus table for add_row');
          return false;

        case 'delete_row':
          if (this.focusTable(tableIndex)) {
            return this.editor.chain().focus().deleteRow().run();
          }
          console.warn('[ToolExecutor] Could not focus table for delete_row');
          return false;

        case 'add_column':
          if (this.focusTable(tableIndex)) {
            return this.editor.chain().focus().addColumnAfter().run();
          }
          console.warn('[ToolExecutor] Could not focus table for add_column');
          return false;

        case 'delete_column':
          if (this.focusTable(tableIndex)) {
            return this.editor.chain().focus().deleteColumn().run();
          }
          console.warn('[ToolExecutor] Could not focus table for delete_column');
          return false;

        case 'update_cell':
          if (this.focusTableCell(tableIndex, rowIndex || 0, columnIndex || 0)) {
            if (content) {
              // Clear cell and insert new content
              return this.editor.chain().focus().deleteSelection().insertContent(content).run();
            }
          }
          console.warn('[ToolExecutor] Could not focus cell for update_cell');
          return false;

        default:
          console.warn('[ToolExecutor] Unknown table action:', action);
          return false;
      }
    } catch (error) {
      console.error('[ToolExecutor] Error in tableEdit:', error);
      return false;
    }
  }

  /**
   * Focus on a specific table in the document
   */
  private focusTable(tableIndex: number): boolean {
    const { doc } = this.editor.state;
    let currentTableIndex = 0;
    let tablePos = -1;

    doc.descendants((node, pos) => {
      if (tablePos >= 0) return false;
      
      if (node.type.name === 'table') {
        if (currentTableIndex === tableIndex) {
          tablePos = pos;
          return false;
        }
        currentTableIndex++;
      }
    });

    if (tablePos >= 0) {
      // Focus inside the table
      this.editor.commands.setTextSelection(tablePos + 2); // +2 to get inside first cell
      return true;
    }

    console.warn('[ToolExecutor] Table not found at index:', tableIndex);
    return false;
  }

  /**
   * Focus on a specific cell in a table
   */
  private focusTableCell(tableIndex: number, rowIndex: number, columnIndex: number): boolean {
    const { doc } = this.editor.state;
    let currentTableIndex = 0;
    let targetPos = -1;

    doc.descendants((node, pos) => {
      if (targetPos >= 0) return false;
      
      if (node.type.name === 'table') {
        if (currentTableIndex === tableIndex) {
          // Found the table, now find the cell
          let currentRow = 0;
          node.descendants((child, childPos) => {
            if (targetPos >= 0) return false;
            
            if (child.type.name === 'tableRow') {
              if (currentRow === rowIndex) {
                let currentCol = 0;
                child.descendants((cellNode, cellPos) => {
                  if (targetPos >= 0) return false;
                  
                  if (cellNode.type.name === 'tableCell' || cellNode.type.name === 'tableHeader') {
                    if (currentCol === columnIndex) {
                      targetPos = pos + childPos + cellPos + 1;
                      return false;
                    }
                    currentCol++;
                  }
                });
              }
              currentRow++;
            }
          });
          return false;
        }
        currentTableIndex++;
      }
    });

    if (targetPos >= 0) {
      this.editor.commands.setTextSelection(targetPos);
      return true;
    }

    console.warn('[ToolExecutor] Cell not found at table:', tableIndex, 'row:', rowIndex, 'col:', columnIndex);
    return false;
  }
}

