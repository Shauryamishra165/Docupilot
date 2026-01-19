/**
 * Bracket Utilities for AI Text Transform
 * 
 * Provides robust utilities for:
 * 1. Inserting brackets around selected text in a block
 * 2. Extracting text from within brackets
 * 3. Replacing bracketed text with new content
 * 4. Removing brackets while preserving content
 */

// Use Unicode characters that are unlikely to appear in normal text
// to avoid conflicts with user content
export const BRACKET_START = '\u2039'; // ‹ (Single Left-Pointing Angle Quotation Mark)
export const BRACKET_END = '\u203A';   // › (Single Right-Pointing Angle Quotation Mark)

// Alternative: Use double brackets for even more robustness
export const BRACKET_START_ALT = '⟦'; // Mathematical left white square bracket
export const BRACKET_END_ALT = '⟧';   // Mathematical right white square bracket

// For markdown output, we use visible markers
export const MD_BRACKET_START = '[AI_SEL_START]';
export const MD_BRACKET_END = '[AI_SEL_END]';

/**
 * Insert brackets around a portion of text at specified offsets
 * 
 * @param text - The full text of the block
 * @param startOffset - Start position within the text (0-indexed)
 * @param endOffset - End position within the text (exclusive)
 * @returns Text with brackets inserted around the selection
 */
export function insertBrackets(
  text: string,
  startOffset: number,
  endOffset: number,
  useMarkdownMarkers = false
): string {
  if (startOffset < 0 || endOffset > text.length || startOffset >= endOffset) {
    throw new Error(
      `Invalid offsets: start=${startOffset}, end=${endOffset}, textLength=${text.length}`
    );
  }

  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  const before = text.slice(0, startOffset);
  const selected = text.slice(startOffset, endOffset);
  const after = text.slice(endOffset);

  return `${before}${start}${selected}${end}${after}`;
}

/**
 * Extract the text content within brackets
 * 
 * @param text - Text containing brackets
 * @returns The text between brackets, or null if not found
 */
export function extractBracketedText(
  text: string,
  useMarkdownMarkers = false
): string | null {
  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null;
  }

  return text.slice(startIdx + start.length, endIdx);
}

/**
 * Remove brackets from text, preserving the content
 * 
 * @param text - Text with brackets
 * @returns Text without brackets
 */
export function removeBrackets(
  text: string,
  useMarkdownMarkers = false
): string {
  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  return text.replace(start, '').replace(end, '');
}

/**
 * Replace the bracketed portion with new content
 * 
 * @param originalText - Original text with brackets
 * @param newContent - New content to replace the bracketed portion
 * @param keepBrackets - Whether to keep brackets around the new content
 * @returns Text with replaced content
 */
export function replaceBracketedContent(
  originalText: string,
  newContent: string,
  keepBrackets = false,
  useMarkdownMarkers = false
): string {
  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  const startIdx = originalText.indexOf(start);
  const endIdx = originalText.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    throw new Error('Brackets not found in text');
  }

  const before = originalText.slice(0, startIdx);
  const after = originalText.slice(endIdx + end.length);

  if (keepBrackets) {
    return `${before}${start}${newContent}${end}${after}`;
  }

  return `${before}${newContent}${after}`;
}

/**
 * Check if text contains our special brackets
 */
export function hasBrackets(text: string, useMarkdownMarkers = false): boolean {
  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  return text.includes(start) && text.includes(end);
}

/**
 * Get the position info of brackets in text
 */
export function getBracketPositions(
  text: string,
  useMarkdownMarkers = false
): { startIdx: number; endIdx: number; startMarkerLength: number; endMarkerLength: number } | null {
  const start = useMarkdownMarkers ? MD_BRACKET_START : BRACKET_START;
  const end = useMarkdownMarkers ? MD_BRACKET_END : BRACKET_END;

  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null;
  }

  return {
    startIdx,
    endIdx,
    startMarkerLength: start.length,
    endMarkerLength: end.length,
  };
}

/**
 * Convert special brackets to markdown markers for sending to AI
 */
export function bracketedToMarkdownMarkers(text: string): string {
  return text
    .replace(BRACKET_START, MD_BRACKET_START)
    .replace(BRACKET_END, MD_BRACKET_END);
}

/**
 * Convert markdown markers back to special brackets
 */
export function markdownMarkersToBracketed(text: string): string {
  return text
    .replace(MD_BRACKET_START, BRACKET_START)
    .replace(MD_BRACKET_END, BRACKET_END);
}

