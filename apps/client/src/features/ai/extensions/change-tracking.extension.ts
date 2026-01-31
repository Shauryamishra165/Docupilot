/**
 * Change Tracking Extension for Tiptap
 * 
 * This extension tracks AI-made changes and allows users to accept or reject them.
 * Changes are APPLIED FIRST, then the user can reject to UNDO them.
 * (Similar to "Track Changes" in Microsoft Word)
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface Change {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  from: number;
  to: number;
  newContent?: string;      // The new content (for insert/replace)
  originalContent?: string; // The original content (for delete/replace - saved for undo)
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

interface ChangeTrackingStorage {
  changes: Change[];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    changeTracking: {
      /**
       * Apply a change and track it for potential rejection
       * The change is APPLIED immediately, and can be undone via rejectChange
       */
      applyTrackedChange: (change: {
        type: 'insert' | 'delete' | 'replace';
        from: number;
        to: number;
        newContent?: string;
      }) => ReturnType;
      
      /**
       * Accept a change (remove from tracking, keep the content)
       */
      acceptChange: (changeId: string) => ReturnType;
      
      /**
       * Reject a change (undo it - restore original content)
       */
      rejectChange: (changeId: string) => ReturnType;
      
      /**
       * Accept all pending changes
       */
      acceptAllChanges: () => ReturnType;
      
      /**
       * Reject all pending changes (undo all)
       */
      rejectAllChanges: () => ReturnType;
      
      /**
       * Clear all tracked changes without applying/rejecting
       */
      clearAllChanges: () => ReturnType;
    };
  }
}

export const ChangeTrackingExtension = Extension.create<{}, ChangeTrackingStorage>({
  name: 'changeTracking',

  addStorage() {
    return {
      changes: [] as Change[],
    };
  },

  addCommands() {
    return {
      /**
       * Apply a change and track it for potential rejection
       */
      applyTrackedChange: (changeData: {
        type: 'insert' | 'delete' | 'replace';
        from: number;
        to: number;
        newContent?: string;
      }) => ({ editor, tr }) => {
        const { type, from, to, newContent } = changeData;
        const doc = editor.state.doc;
        
        // Save original content for potential undo
        let originalContent = '';
        if (type === 'delete' || type === 'replace') {
          try {
            originalContent = doc.textBetween(from, Math.min(to, doc.content.size), ' ');
          } catch (e) {
            console.warn('[ChangeTracking] Could not get original content:', e);
          }
        }
        
        // Generate change ID
        const changeId = `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create the change record BEFORE applying
        const change: Change = {
          id: changeId,
          type,
          from,
          to,
          newContent: newContent || '',
          originalContent,
          timestamp: Date.now(),
          status: 'pending',
        };
        
        // APPLY the change to the document using a SINGLE chain to avoid duplicates
        try {
          const chain = editor.chain().focus();
          
          switch (type) {
            case 'insert':
              if (newContent) {
                chain.setTextSelection(from).insertContent(newContent);
                const success = chain.run();
                if (success) {
                  // Update 'to' to reflect the new content
                  change.to = editor.state.selection.to;
                }
              }
              break;
              
            case 'delete': {
              chain.setTextSelection({ from, to }).deleteSelection();
              chain.run();
              // For delete, to becomes same as from after deletion
              change.to = from;
              break;
            }
              
            case 'replace':
              if (newContent) {
                // Select the range, delete, then insert new content
                chain.setTextSelection({ from, to }).deleteSelection().insertContent(newContent);
                const success = chain.run();
                if (success) {
                  // Update 'to' to reflect new content
                  change.to = editor.state.selection.to;
                }
              }
              break;
          }
          
          // Store the change AFTER applying
          editor.storage.changeTracking.changes.push(change);
          
          console.log('[ChangeTracking] Applied and tracked change:', change.id, type, 'from', from, 'to', change.to);
          return true;
        } catch (error) {
          console.error('[ChangeTracking] Error applying change:', error);
          return false;
        }
      },

      /**
       * Accept a change - just remove from tracking (content stays)
       */
      acceptChange: (changeId: string) => ({ editor }) => {
        const storage = editor.storage.changeTracking as ChangeTrackingStorage;
        const changeIndex = storage.changes.findIndex((c: Change) => c.id === changeId);
        
        if (changeIndex === -1) {
          console.warn('[ChangeTracking] Change not found:', changeId);
          return false;
        }
        
        const change = storage.changes[changeIndex];
        if (change.status !== 'pending') {
          return false;
        }
        
        // Mark as accepted and remove from tracking
        change.status = 'accepted';
        storage.changes.splice(changeIndex, 1);
        
        // Force decoration update
        editor.view.dispatch(editor.state.tr);
        
        console.log('[ChangeTracking] Accepted change:', changeId);
        return true;
      },

      /**
       * Reject a change - UNDO it (restore original content)
       */
      rejectChange: (changeId: string) => ({ editor }) => {
        const storage = editor.storage.changeTracking as ChangeTrackingStorage;
        const changeIndex = storage.changes.findIndex((c: Change) => c.id === changeId);
        
        if (changeIndex === -1) {
          console.warn('[ChangeTracking] Change not found:', changeId);
          return false;
        }
        
        const change = storage.changes[changeIndex];
        if (change.status !== 'pending') {
          return false;
        }
        
        try {
          let transaction = editor.state.tr;
          
          // UNDO the change based on type
          switch (change.type) {
            case 'insert':
              // Delete the inserted content
              transaction = transaction.delete(change.from, change.to);
              break;
              
            case 'delete':
              // Re-insert the original content
              if (change.originalContent) {
                transaction = transaction.insertText(change.originalContent, change.from);
              }
              break;
              
            case 'replace':
              // Delete the new content and re-insert original
              transaction = transaction.delete(change.from, change.to);
              if (change.originalContent) {
                transaction = transaction.insertText(change.originalContent, change.from);
              }
              break;
          }
          
          // Mark as rejected and remove from tracking
          change.status = 'rejected';
          storage.changes.splice(changeIndex, 1);
          
          // Dispatch undo transaction
          editor.view.dispatch(transaction);
          
          console.log('[ChangeTracking] Rejected (undone) change:', changeId);
          return true;
        } catch (error) {
          console.error('[ChangeTracking] Error rejecting change:', error);
          // Still remove from tracking to avoid stuck changes
          storage.changes.splice(changeIndex, 1);
          return false;
        }
      },

      /**
       * Accept all pending changes
       */
      acceptAllChanges: () => ({ editor }) => {
        const storage = editor.storage.changeTracking as ChangeTrackingStorage;
        const pendingCount = storage.changes.filter((c: Change) => c.status === 'pending').length;
        
        // Just clear all pending changes (content stays)
        storage.changes = storage.changes.filter((c: Change) => c.status !== 'pending');
        
        // Force decoration update
        editor.view.dispatch(editor.state.tr);
        
        console.log('[ChangeTracking] Accepted all changes:', pendingCount);
        return true;
      },

      /**
       * Reject all pending changes (undo all)
       */
      rejectAllChanges: () => ({ editor }) => {
        const storage = editor.storage.changeTracking as ChangeTrackingStorage;
        const pendingChanges = storage.changes.filter((c: Change) => c.status === 'pending');
        
        if (pendingChanges.length === 0) {
          return true;
        }
        
        // Sort by position descending (undo from end to start to preserve positions)
        pendingChanges.sort((a, b) => b.from - a.from);
        
        let transaction = editor.state.tr;
        
        try {
          pendingChanges.forEach((change: Change) => {
            switch (change.type) {
              case 'insert':
                transaction = transaction.delete(change.from, change.to);
                break;
                
              case 'delete':
                if (change.originalContent) {
                  transaction = transaction.insertText(change.originalContent, change.from);
                }
                break;
                
              case 'replace':
                transaction = transaction.delete(change.from, change.to);
                if (change.originalContent) {
                  transaction = transaction.insertText(change.originalContent, change.from);
                }
                break;
            }
          });
          
          // Clear all pending changes
          storage.changes = storage.changes.filter((c: Change) => c.status !== 'pending');
          
          editor.view.dispatch(transaction);
          
          console.log('[ChangeTracking] Rejected all changes:', pendingChanges.length);
          return true;
        } catch (error) {
          console.error('[ChangeTracking] Error rejecting all changes:', error);
          storage.changes = [];
          return false;
        }
      },

      clearAllChanges: () => ({ editor }) => {
        const storage = editor.storage.changeTracking as ChangeTrackingStorage;
        storage.changes = [];
        editor.view.dispatch(editor.state.tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: new PluginKey('changeTrackingDecorations'),

        state: {
          init: () => DecorationSet.empty,
          apply: (_tr, _decorationSet, _oldState, newState) => {
            const changes = (extension.storage?.changes || []).filter((c: Change) => c.status === 'pending');

            if (changes.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];

            changes.forEach((change: Change) => {
              const docSize = newState.doc.content.size;
              const safeFrom = Math.max(0, Math.min(change.from, docSize));
              const safeTo = Math.max(safeFrom, Math.min(change.to, docSize));
              
              if (safeFrom >= docSize) return;

              // Create decoration to highlight the changed content
              if (change.type === 'insert' || change.type === 'replace') {
                // Highlight the new content (green for insert, yellow for replace)
                const className = change.type === 'insert' ? 'ai-change-insert' : 'ai-change-replace';
                
                if (safeTo > safeFrom) {
                  decorations.push(
                    Decoration.inline(safeFrom, safeTo, {
                      class: className,
                      'data-change-id': change.id,
                    })
                  );
                }
                
                // Add accept/reject buttons at the end
                decorations.push(
                  Decoration.widget(safeTo, () => {
                    const buttons = document.createElement('span');
                    buttons.className = 'ai-change-buttons';
                    buttons.innerHTML = `
                      <button class="ai-change-accept" data-change-id="${change.id}" title="Accept change">✓</button>
                      <button class="ai-change-reject" data-change-id="${change.id}" title="Reject (undo)">✗</button>
                    `;
                    return buttons;
                  }, { side: 1 })
                );
              } else if (change.type === 'delete') {
                // For deletions that were applied, we can't highlight (content is gone)
                // Show a widget indicating something was deleted
                decorations.push(
                  Decoration.widget(safeFrom, () => {
                    const span = document.createElement('span');
                    span.className = 'ai-change-delete-marker';
                    span.innerHTML = `
                      <span class="ai-change-deleted-text" title="Deleted: ${change.originalContent}">[deleted]</span>
                      <span class="ai-change-buttons">
                        <button class="ai-change-accept" data-change-id="${change.id}" title="Accept deletion">✓</button>
                        <button class="ai-change-reject" data-change-id="${change.id}" title="Restore deleted text">✗</button>
                      </span>
                    `;
                    return span;
                  }, { side: 1 })
                );
              }
            });

            return DecorationSet.create(newState.doc, decorations);
          },
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },

          handleDOMEvents: {
            click: (view, event) => {
              const target = event.target as HTMLElement;
              
              if (target.classList.contains('ai-change-accept')) {
                const changeId = target.getAttribute('data-change-id');
                if (changeId && extension.editor) {
                  event.preventDefault();
                  event.stopPropagation();
                  extension.editor.commands.acceptChange(changeId);
                  return true;
                }
              }
              
              if (target.classList.contains('ai-change-reject')) {
                const changeId = target.getAttribute('data-change-id');
                if (changeId && extension.editor) {
                  event.preventDefault();
                  event.stopPropagation();
                  extension.editor.commands.rejectChange(changeId);
                  return true;
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
