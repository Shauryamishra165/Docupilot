/**
 * Block Utilities for AI Text Transform
 * 
 * Provides utilities for extracting block information from the editor
 * based on the current selection.
 */

import { Editor, findParentNode } from '@tiptap/core';
import { Node as ProsemirrorNode } from '@tiptap/pm/model';
import { BlockInfo, SelectionInfo } from './types';

// Block-level node types in TipTap/ProseMirror
const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'listItem',
  'taskItem',
  'callout',
  'tableCell',
  'tableHeader',
];

/**
 * Check if a node is a block-level node
 */
function isBlockNode(node: ProsemirrorNode): boolean {
  return BLOCK_TYPES.includes(node.type.name) || node.isBlock;
}

/**
 * Get the parent block node containing the current selection
 */
export function getParentBlock(editor: Editor): BlockInfo | null {
  const { state } = editor;
  const { selection } = state;
  const { $from } = selection;

  // Find the closest block-level parent
  const parentResult = findParentNode(isBlockNode)(selection);

  if (!parentResult) {
    // If no block found, try getting the direct parent at depth 1
    if ($from.depth >= 1) {
      const node = $from.node(1);
      const pos = $from.before(1);
      const start = $from.start(1);
      
      return {
        node,
        pos,
        start,
        text: node.textContent,
        type: node.type.name,
      };
    }
    return null;
  }

  return {
    node: parentResult.node,
    pos: parentResult.pos,
    start: parentResult.start,
    text: parentResult.node.textContent,
    type: parentResult.node.type.name,
  };
}

/**
 * Get information about the current selection
 */
export function getSelectionInfo(editor: Editor): SelectionInfo | null {
  const { state } = editor;
  const { selection } = state;
  const { from, to, empty } = selection;

  if (empty) {
    return null;
  }

  const selectedText = state.doc.textBetween(from, to);
  
  // Get the block to calculate offset within block
  const blockInfo = getParentBlock(editor);
  let offsetInBlock = 0;
  
  if (blockInfo) {
    // The offset is the selection start minus the block's content start
    offsetInBlock = from - blockInfo.start;
  }

  return {
    selectedText,
    from,
    to,
    offsetInBlock,
    length: selectedText.length,
  };
}

/**
 * Get both block and selection info combined
 */
export function getBlockAndSelectionInfo(
  editor: Editor
): { block: BlockInfo; selection: SelectionInfo } | null {
  const block = getParentBlock(editor);
  const selection = getSelectionInfo(editor);

  if (!block || !selection) {
    return null;
  }

  return { block, selection };
}

/**
 * Get text content from a node, handling nested content
 */
export function getNodeTextContent(node: ProsemirrorNode): string {
  return node.textContent;
}

/**
 * Convert a block node to JSON for potential serialization
 */
export function blockToJson(node: ProsemirrorNode): any {
  return node.toJSON();
}

/**
 * Create a simple markdown representation of the block
 * This is a basic implementation - can be enhanced as needed
 */
export function blockToMarkdown(blockInfo: BlockInfo): string {
  const { type, text } = blockInfo;
  
  switch (type) {
    case 'heading':
      const level = blockInfo.node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${text}`;
    
    case 'codeBlock':
      const language = blockInfo.node.attrs?.language || '';
      return `\`\`\`${language}\n${text}\n\`\`\``;
    
    case 'blockquote':
      return `> ${text}`;
    
    case 'listItem':
    case 'taskItem':
      return `- ${text}`;
    
    case 'paragraph':
    default:
      return text;
  }
}

/**
 * Replace the content of a block in the editor
 * 
 * @param editor - The TipTap editor instance
 * @param blockInfo - The block to replace
 * @param newText - The new text content
 * @returns Whether the replacement was successful
 */
export function replaceBlockContent(
  editor: Editor,
  blockInfo: BlockInfo,
  newText: string
): boolean {
  try {
    const { state, view } = editor;
    const { tr } = state;

    // Calculate positions for the text content within the block
    const contentStart = blockInfo.start;
    const contentEnd = blockInfo.start + blockInfo.text.length;

    // Create a text node with the new content
    const textNode = state.schema.text(newText);

    // Replace the content
    tr.replaceWith(contentStart, contentEnd, textNode);
    
    view.dispatch(tr);
    return true;
  } catch (error) {
    console.error('[BlockUtils] Error replacing block content:', error);
    return false;
  }
}

/**
 * Replace only the selected portion within a block
 * 
 * @param editor - The TipTap editor instance
 * @param selectionInfo - The selection to replace
 * @param newText - The new text content
 * @returns Whether the replacement was successful
 */
export function replaceSelection(
  editor: Editor,
  selectionInfo: SelectionInfo,
  newText: string
): boolean {
  try {
    const { state, view } = editor;
    const { tr } = state;

    // Replace the selection range
    tr.insertText(newText, selectionInfo.from, selectionInfo.to);
    
    view.dispatch(tr);
    return true;
  } catch (error) {
    console.error('[BlockUtils] Error replacing selection:', error);
    return false;
  }
}

