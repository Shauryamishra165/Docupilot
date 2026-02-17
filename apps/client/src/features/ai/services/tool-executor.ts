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
 * Always converts markdown to ensure proper formatting (bold, italic, headings, etc.)
 */
function convertMarkdownToHtml(content: string): string {
  if (!content || content.trim().length === 0) {
    return content;
  }

  try {
    // Always try to convert markdown - this ensures **bold**, *italic*, etc. are rendered properly
    // The markdownToHtml function handles plain text safely
    const html = markdownToHtml(content);
    const result = html as string;

    // Log for debugging
    console.log('[ToolExecutor] Markdown conversion:', {
      inputLength: content.length,
      outputLength: result.length,
      inputPreview: content.substring(0, 100),
      outputPreview: result.substring(0, 100),
    });

    // Verify conversion produced HTML (should contain tags)
    if (result && result.includes('<')) {
      return result;
    }

    // If no HTML tags, wrap in paragraph for proper handling
    console.warn('[ToolExecutor] Markdown conversion produced no HTML tags, wrapping in <p>');
    return `<p>${content}</p>`;
  } catch (error) {
    console.error('[ToolExecutor] Markdown conversion failed:', error);
    // Fallback: wrap content in paragraph tag for basic HTML structure
    return `<p>${content.replace(/\n/g, '</p><p>')}</p>`;
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
      // Check if ChangeTrackingExtension is available
      const editorCommands = this.editor.commands as any;
      const hasChangeTracking = typeof editorCommands.applyTrackedChange === 'function';

      console.log('[ToolExecutor] createInlineChange:', {
        tool: toolCall.tool,
        hasChangeTracking,
      });

      // For table operations, execute directly WITHOUT change tracking.
      // Tables are block-level nodes - inline decorations don't work on them
      // and would cause visual artifacts.
      if (toolCall.tool === 'table_edit') {
        console.log('[ToolExecutor] table_edit - executing directly (no inline tracking)');
        return this.executeInternal(toolCall);
      }

      // For semantic insertion, track the insertion position
      if (toolCall.tool === 'insert_after_section') {
        console.log('[ToolExecutor] insert_after_section - executing with tracking');
        const beforeSize = this.editor.state.doc.content.size;
        const success = this.executeInternal(toolCall);

        // Try to track the insertion
        if (success && hasChangeTracking) {
          const afterSize = this.editor.state.doc.content.size;
          const params = toolCall.params as InsertAfterSectionTool['params'];
          const insertedLength = afterSize - beforeSize;

          if (insertedLength > 0) {
            // Find approximate insertion position
            const insertPos = afterSize - insertedLength;
            try {
              editorCommands.applyTrackedChange({
                type: 'insert',
                from: insertPos,
                to: afterSize,
                newContent: params.content || '',
              });
            } catch (e) {
              console.log('[ToolExecutor] Could not track insert_after_section change:', e);
            }
          }
        }
        return success;
      }

      // For insert_content, use direct execution then track (more reliable)
      if (toolCall.tool === 'insert_content') {
        console.log('[ToolExecutor] insert_content - executing with tracking');
        const params = toolCall.params as InsertContentTool['params'];
        const beforeSize = this.editor.state.doc.content.size;

        // Execute directly (this handles markdown conversion properly)
        const success = this.executeInternal(toolCall);

        // Track the insertion for accept/reject
        if (success && hasChangeTracking) {
          const afterSize = this.editor.state.doc.content.size;
          const insertedLength = afterSize - beforeSize;

          if (insertedLength > 0) {
            const insertPos = params.position === 'start' ? 1 : (beforeSize > 0 ? beforeSize - 1 : 0);
            try {
              // Add to change tracking storage directly
              const change = {
                id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'insert' as const,
                from: insertPos,
                to: insertPos + insertedLength,
                newContent: params.content || '',
                originalContent: '',
                timestamp: Date.now(),
                status: 'pending' as const,
              };
              this.editor.storage.changeTracking?.changes?.push(change);
              // Force decoration update
              this.editor.view.dispatch(this.editor.state.tr);
              console.log('[ToolExecutor] Tracked insert_content change:', change.id);
            } catch (e) {
              console.log('[ToolExecutor] Could not track insert_content change:', e);
            }
          }
        }
        return success;
      }

      // Find positions where the change should apply
      const positions = this.findChangePositions(toolCall);

      if (positions.length === 0) {
        console.warn('[ToolExecutor] No positions found for inline change');
        // Fall back to direct execution
        return this.executeInternal(toolCall);
      }

      console.log('[ToolExecutor] Found', positions.length, 'position(s) for inline change');

      if (!hasChangeTracking) {
        console.warn('[ToolExecutor] ChangeTrackingExtension not available, falling back to direct execution');
        return this.executeInternal(toolCall);
      }

      // For multiple positions (like replaceAll), we need special handling
      // Each change affects document positions, so we track them carefully
      if (positions.length > 1) {
        console.log('[ToolExecutor] Multiple positions detected:', positions.length);

        // Sort positions from end to start to avoid position shifting
        const sortedPositions = [...positions].sort((a, b) => b.from - a.from);

        // Apply all changes and track each one
        // Since we process from end to start, earlier positions remain valid
        let successCount = 0;
        let positionOffset = 0; // Track cumulative position offset

        for (let i = 0; i < sortedPositions.length; i++) {
          const pos = sortedPositions[i];
          const originalLength = pos.to - pos.from;
          const newLength = pos.newContent.length;
          const lengthDiff = newLength - originalLength;

          try {
            // Apply this change with tracking
            const success = editorCommands.applyTrackedChange({
              type: 'replace',
              from: pos.from,
              to: pos.to,
              newContent: pos.newContent,
            });

            if (success) {
              successCount++;
              console.log(`[ToolExecutor] Applied tracked change ${i + 1}/${sortedPositions.length} at ${pos.from}`);
            } else {
              console.warn(`[ToolExecutor] Failed to apply change at ${pos.from}`);
            }
          } catch (e) {
            console.error(`[ToolExecutor] Error applying change at ${pos.from}:`, e);
          }
        }

        console.log(`[ToolExecutor] Applied ${successCount}/${sortedPositions.length} tracked changes`);
        return successCount > 0;
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

      const docSize = this.editor.state.doc.content.size;

      // Calculate insert position
      // Note: For 'end', we use docSize - 1 to be inside the document, not past it
      let insertPos = 0;
      switch (position) {
        case 'start':
          insertPos = 1; // Position 1 is inside the first paragraph
          break;
        case 'end':
          // Position at the end of the document content (before closing tag)
          insertPos = Math.max(1, docSize - 1);
          break;
        case 'cursor':
        case 'after_selection':
        default:
          insertPos = this.editor.state.selection.to;
          break;
      }

      console.log('[ToolExecutor] insert_content position:', {
        requestedPosition: position,
        calculatedPos: insertPos,
        docSize,
        contentType,
        contentLength: content?.length || 0,
      });

      // Convert markdown to HTML - always convert for consistent formatting
      let processedContent = content || '';
      if (contentType === 'markdown' || contentType === 'text' || !contentType) {
        processedContent = convertMarkdownToHtml(processedContent);
        console.log('[ToolExecutor] Converted markdown to HTML:', {
          originalLength: content?.length,
          htmlLength: processedContent.length,
          htmlPreview: processedContent.substring(0, 200),
        });
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

    console.log('[ToolExecutor] insertContent called:', {
      contentLength: content.length,
      position,
      contentType,
      contentPreview: content.substring(0, 100),
    });

    try {
      // Convert markdown to HTML for proper editor rendering
      let insertableContent: string;

      if (contentType === 'markdown' || contentType === 'text') {
        // Convert markdown to HTML
        insertableContent = convertMarkdownToHtml(content);
      } else if (contentType === 'html') {
        insertableContent = content;
      } else {
        // Default: treat as markdown
        insertableContent = convertMarkdownToHtml(content);
      }

      console.log('[ToolExecutor] Final content to insert:', {
        contentLength: insertableContent.length,
        isHTML: insertableContent.includes('<'),
        preview: insertableContent.substring(0, 150),
      });

      // Use chain for more reliable insertion
      let success = false;

      switch (position) {
        case 'start':
          success = this.editor
            .chain()
            .focus('start')
            .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
            .run();
          break;

        case 'end':
          success = this.editor
            .chain()
            .focus('end')
            .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
            .run();
          break;

        case 'cursor':
          success = this.editor
            .chain()
            .focus()
            .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
            .run();
          break;

        case 'after_selection':
          const { to } = this.editor.state.selection;
          success = this.editor
            .chain()
            .focus()
            .setTextSelection(to)
            .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
            .run();
          break;

        default:
          console.warn('[ToolExecutor] Unknown insert position:', position, '- defaulting to cursor');
          success = this.editor
            .chain()
            .focus()
            .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
            .run();
      }

      console.log('[ToolExecutor] insertContent result:', success);
      return success;
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

    console.log('[ToolExecutor] insertAfterSection called:', {
      sectionTitle,
      contentLength: content.length,
      contentType,
    });

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

      // Convert markdown to HTML - ALWAYS convert to ensure proper formatting
      let insertableContent = convertMarkdownToHtml(content);

      console.log('[ToolExecutor] insertAfterSection: Inserting at position', insertPosition);
      console.log('[ToolExecutor] insertAfterSection: HTML content preview:', insertableContent.substring(0, 150));

      // Move cursor to position and insert using chain
      const success = this.editor
        .chain()
        .focus()
        .setTextSelection(insertPosition)
        .insertContent(insertableContent, { parseOptions: { preserveWhitespace: 'full' } })
        .run();

      console.log('[ToolExecutor] insertAfterSection result:', success);
      return success;
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

    console.log('[ToolExecutor] tableEdit called:', {
      action,
      tableIndex,
      rowIndex,
      columnIndex,
      rows,
      columns,
      hasContent: !!content,
    });

    try {
      // Check if table commands are available
      const editorCommands = this.editor.commands as any;
      if (!editorCommands.insertTable) {
        console.error('[ToolExecutor] insertTable command not available - Table extension may not be loaded');
        return false;
      }

      switch (action) {
        case 'create_table': {
          // Create a new table with specified dimensions
          const numRows = Math.max(1, Math.round(Number(rows) || 3));
          const numCols = Math.max(1, Math.round(Number(columns) || 3));
          console.log('[ToolExecutor] Creating table with', numRows, 'rows and', numCols, 'columns');

          // Parse content for pre-filled tables
          let headers: string[] = [];
          let data: string[][] = [];

          if (content) {
            try {
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                // Content is a plain array - treat as headers
                headers = parsed.map(String);
              } else if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.headers)) {
                  headers = parsed.headers.map(String);
                }
                if (Array.isArray(parsed.data)) {
                  data = parsed.data.map((row: any) =>
                    Array.isArray(row) ? row.map(String) : [String(row)]
                  );
                }
              }
            } catch {
              // Not JSON - try comma-separated headers
              headers = content.split(',').map((h: string) => h.trim()).filter(Boolean);
            }
            console.log('[ToolExecutor] Parsed content:', headers.length, 'headers,', data.length, 'data rows');
          }

          // Escape HTML special characters in cell text
          const escapeHtml = (text: string) =>
            text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

          // Build HTML table (most reliable method, supports pre-filled content)
          let tableHtml = '<table>';

          // Header row
          tableHtml += '<tr>';
          for (let c = 0; c < numCols; c++) {
            const headerText = headers[c] || `Header ${c + 1}`;
            tableHtml += `<th><p>${escapeHtml(headerText)}</p></th>`;
          }
          tableHtml += '</tr>';

          // Data rows
          for (let r = 1; r < numRows; r++) {
            tableHtml += '<tr>';
            for (let c = 0; c < numCols; c++) {
              const cellText = data[r - 1]?.[c] || '';
              tableHtml += `<td><p>${cellText ? escapeHtml(cellText) : ''}</p></td>`;
            }
            tableHtml += '</tr>';
          }

          tableHtml += '</table><p></p>';

          // First, ensure we're focused at a valid position
          this.editor.commands.focus('end');

          const success = this.editor
            .chain()
            .focus('end')
            .insertContent(tableHtml)
            .run();

          if (success) {
            console.log('[ToolExecutor] Table created via HTML');
            return true;
          }

          // Fallback: Try insertTable command (for empty tables only)
          console.log('[ToolExecutor] HTML table failed, trying insertTable command');
          try {
            const insertTableExists = typeof (this.editor.commands as any).insertTable === 'function';
            if (insertTableExists) {
              // Add paragraph first for valid insertion point
              this.editor.chain().focus('end').createParagraphNear().run();
              const fallbackSuccess = this.editor
                .chain()
                .focus()
                .insertTable({ rows: numRows, cols: numCols, withHeaderRow: true })
                .run();

              if (fallbackSuccess) {
                console.log('[ToolExecutor] Table created via insertTable fallback');
                return true;
              }
            }
          } catch (e) {
            console.log('[ToolExecutor] insertTable fallback failed:', e);
          }

          console.error('[ToolExecutor] All table creation methods failed');
          return false;
        }

        case 'add_row': {
          // Focus the target row (or first row as fallback), then add row after it
          const addRowTarget = rowIndex !== undefined ? rowIndex : 0;
          if (this.focusTableCell(tableIndex, addRowTarget, 0)) {
            const success = this.editor.chain().focus().addRowAfter().run();
            console.log('[ToolExecutor] add_row result:', success);
            return success;
          }
          console.warn('[ToolExecutor] Could not focus table for add_row');
          return false;
        }

        case 'delete_row': {
          // Focus the target row, then delete it
          const deleteRowTarget = rowIndex !== undefined ? rowIndex : 0;
          if (this.focusTableCell(tableIndex, deleteRowTarget, 0)) {
            const success = this.editor.chain().focus().deleteRow().run();
            console.log('[ToolExecutor] delete_row result:', success);
            return success;
          }
          console.warn('[ToolExecutor] Could not focus table for delete_row');
          return false;
        }

        case 'add_column': {
          // Focus the target column, then add column after it
          const addColTarget = columnIndex !== undefined ? columnIndex : 0;
          if (this.focusTableCell(tableIndex, 0, addColTarget)) {
            const success = this.editor.chain().focus().addColumnAfter().run();
            console.log('[ToolExecutor] add_column result:', success);
            return success;
          }
          console.warn('[ToolExecutor] Could not focus table for add_column');
          return false;
        }

        case 'delete_column': {
          // Focus the target column, then delete it
          const deleteColTarget = columnIndex !== undefined ? columnIndex : 0;
          if (this.focusTableCell(tableIndex, 0, deleteColTarget)) {
            const success = this.editor.chain().focus().deleteColumn().run();
            console.log('[ToolExecutor] delete_column result:', success);
            return success;
          }
          console.warn('[ToolExecutor] Could not focus table for delete_column');
          return false;
        }

        case 'update_cell': {
          if (this.focusTableCell(tableIndex, rowIndex || 0, columnIndex || 0)) {
            if (content) {
              // Select the entire cell content before replacing
              const { doc, selection } = this.editor.state;
              const $pos = doc.resolve(selection.from);

              // Walk up the depth to find the cell node
              for (let depth = $pos.depth; depth > 0; depth--) {
                const node = $pos.node(depth);
                if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                  const cellStart = $pos.start(depth);
                  const cellEnd = $pos.end(depth);

                  // Select entire cell content and replace it
                  const success = this.editor
                    .chain()
                    .focus()
                    .setTextSelection({ from: cellStart, to: cellEnd })
                    .deleteSelection()
                    .insertContent(content)
                    .run();
                  console.log('[ToolExecutor] update_cell result:', success);
                  return success;
                }
              }

              // Fallback: just insert at cursor position
              console.warn('[ToolExecutor] update_cell: Could not find cell boundaries, inserting at cursor');
              const success = this.editor.chain().focus().insertContent(content).run();
              console.log('[ToolExecutor] update_cell fallback result:', success);
              return success;
            }
            console.warn('[ToolExecutor] update_cell: No content provided');
            return false;
          }
          console.warn('[ToolExecutor] Could not focus cell for update_cell');
          return false;
        }

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
   * Focus on a specific table in the document (first cell)
   */
  private focusTable(tableIndex: number): boolean {
    return this.focusTableCell(tableIndex, 0, 0);
  }

  /**
   * Focus on a specific cell in a table
   *
   * Position calculation for ProseMirror table structure:
   *   table (pos) > tableRow (pos+1) > tableCell/tableHeader (pos+2) > paragraph (pos+3) > cursor (pos+4)
   *
   * For nested descendants:
   *   table.descendants gives childPos relative to table content start
   *   row.descendants gives cellPos relative to row content start
   *   Absolute cursor position = pos + 1 (enter table) + childPos + 1 (enter row) + cellPos + 1 (enter cell) + 1 (enter paragraph)
   *                            = pos + childPos + cellPos + 4
   */
  private focusTableCell(tableIndex: number, rowIndex: number, columnIndex: number): boolean {
    const { doc } = this.editor.state;
    let currentTableIndex = 0;
    let targetPos = -1;

    doc.descendants((node, pos) => {
      if (targetPos >= 0) return false;

      if (node.type.name === 'table') {
        if (currentTableIndex === tableIndex) {
          // Found the target table, now find the target cell
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
                      // pos = table absolute position in document
                      // +1 = enter table content
                      // childPos = row position relative to table content
                      // +1 = enter row content
                      // cellPos = cell position relative to row content
                      // +1 = enter cell content
                      // +1 = enter paragraph (first child of cell)
                      targetPos = pos + childPos + cellPos + 4;
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
      // Verify position is within document bounds
      if (targetPos > doc.content.size) {
        console.warn('[ToolExecutor] Target position', targetPos, 'exceeds document size', doc.content.size);
        return false;
      }

      try {
        this.editor.commands.setTextSelection(targetPos);
        return true;
      } catch (e) {
        console.warn('[ToolExecutor] Failed to set text selection at position:', targetPos, e);
        return false;
      }
    }

    console.warn('[ToolExecutor] Cell not found at table:', tableIndex, 'row:', rowIndex, 'col:', columnIndex);
    return false;
  }
}

