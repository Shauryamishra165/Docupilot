import * as mammoth from 'mammoth';

/**
 * Options for DOCX to HTML conversion
 */
export interface DocxToHtmlOptions {
  /**
   * Custom style mappings for mammoth
   */
  styleMap?: string[];
  /**
   * Whether to include default styling
   */
  includeDefaultStyleMap?: boolean;
}

/**
 * Result of DOCX to HTML conversion
 */
export interface DocxToHtmlResult {
  /**
   * The converted HTML string
   */
  html: string;
  /**
   * Warning messages from the conversion process
   */
  messages: string[];
}

/**
 * Converts a DOCX buffer to HTML using mammoth.
 *
 * @param buffer - The DOCX file content as a Buffer
 * @param options - Optional configuration for the conversion
 * @returns A promise resolving to the conversion result with HTML and messages
 *
 * @example
 * ```typescript
 * const buffer = await fs.readFile('document.docx');
 * const { html, messages } = await docxToHtml(buffer);
 * console.log(html);
 * ```
 */
export async function docxToHtml(
  buffer: Buffer,
  options?: DocxToHtmlOptions,
): Promise<DocxToHtmlResult> {
  const mammothOptions: Record<string, any> = {};

  if (options?.styleMap) {
    mammothOptions.styleMap = options.styleMap;
  }

  if (options?.includeDefaultStyleMap !== undefined) {
    mammothOptions.includeDefaultStyleMap = options.includeDefaultStyleMap;
  }

  const result = await mammoth.convertToHtml(
    { buffer },
    mammothOptions,
  );

  return {
    html: result.value,
    messages: result.messages.map((msg) => msg.message),
  };
}

/**
 * Converts a DOCX buffer to HTML string only.
 * A simpler version that returns just the HTML content.
 *
 * @param buffer - The DOCX file content as a Buffer
 * @returns A promise resolving to the HTML string
 *
 * @example
 * ```typescript
 * const buffer = await fs.readFile('document.docx');
 * const html = await docxBufferToHtml(buffer);
 * ```
 */
export async function docxBufferToHtml(buffer: Buffer): Promise<string> {
  const { html } = await docxToHtml(buffer);
  return html;
}

