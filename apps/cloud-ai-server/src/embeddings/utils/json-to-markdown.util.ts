import { JSONContent } from '@tiptap/core';
import { jsonToHtml } from '../../collaboration/collaboration.util';
import { turndown } from '../../integrations/export/turndown-utils';

/**
 * Convert TipTap/ProseMirror JSON to Markdown format
 * This preserves structure better than plain text for embeddings
 */
export function jsonToMarkdown(tiptapJson: JSONContent): string {
    // Step 1: Convert JSON to HTML
    const html = jsonToHtml(tiptapJson);
    
    // Step 2: Convert HTML to Markdown using turndown
    // Remove colgroup tags that turndown doesn't handle well
    const cleanedHtml = html.replace(
        /<colgroup[^>]*>[\s\S]*?<\/colgroup>/gim,
        '',
    );
    
    const markdown = turndown(cleanedHtml);
    
    return markdown;
}
