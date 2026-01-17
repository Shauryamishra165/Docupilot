# Document Reading API

## Overview

The Document Reading API allows you to read and retrieve page content from Docmost, format it in various ways, and send it to the external AI service (port 8000) for processing.

## Endpoint

```
POST /api/external-service/ai/document/read
```

## Authentication

- **Required**: JWT token (via Cookie header)
- **Permission**: Requires `WorkspaceCaslAction.Read` permission on `WorkspaceCaslSubject.Settings`
- **Rate Limit**: 30 requests per minute per user/workspace

## Request Parameters

### Request Body

```typescript
{
  pageId: string;              // Required: UUID of the page to read
  format?: 'json' | 'text' | 'html' | 'markdown';  // Optional: Output format (default: 'text')
  includeMetadata?: boolean;   // Optional: Include page metadata (default: false)
}
```

### Parameter Details

| Parameter | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `pageId` | `string` (UUID) | ✅ Yes | - | The unique identifier of the page to read |
| `format` | `'json' \| 'text' \| 'html' \| 'markdown'` | ❌ No | `'text'` | Format for the content output |
| `includeMetadata` | `boolean` | ❌ No | `false` | Whether to include page metadata in response |

## Response Format

### Success Response (200 OK)

```typescript
{
  pageId: string;              // Page UUID
  title: string;               // Page title
  content: string;             // Formatted content based on format parameter
  format: string;              // Format used ('json', 'text', 'html', 'markdown')
  metadata?: {                 // Included if includeMetadata=true
    wordCount: number;         // Number of words in content
    characterCount: number;    // Number of characters in content
    createdAt: string;         // ISO 8601 timestamp of page creation
    updatedAt: string;         // ISO 8601 timestamp of last update
    author?: string;          // Name of the page creator (if available)
  };
  success: boolean;            // Always true for successful requests
}
```

### Error Responses

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": ["pageId must be a UUID", "format must be one of: json, text, html, markdown"],
  "error": "Bad Request"
}
```

#### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}
```

#### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Page not found",
  "error": "Not Found"
}
```

#### 429 Too Many Requests
```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Please try again in X seconds.",
  "error": "Too Many Requests"
}
```

#### 503 Service Unavailable
```json
{
  "statusCode": 503,
  "message": "External service is currently unavailable",
  "error": "Service Unavailable"
}
```

## Content Format Examples

### Format: `'text'` (Default)
Plain text extraction from ProseMirror JSON:
```
This is a sample document with multiple paragraphs.

It can contain headings, lists, and other content types.
```

### Format: `'html'`
HTML representation:
```html
<p>This is a sample document with multiple paragraphs.</p>
<p>It can contain <strong>headings</strong>, lists, and other content types.</p>
```

### Format: `'json'`
Raw ProseMirror JSON structure:
```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "This is a sample document"
        }
      ]
    }
  ]
}
```

### Format: `'markdown'`
Markdown representation (currently uses text format, can be enhanced):
```
This is a sample document with multiple paragraphs.

It can contain headings, lists, and other content types.
```

## Request Flow

```
Frontend (React)
  ↓ POST /api/external-service/ai/document/read
  ↓ Headers: { Cookie: JWT }
  ↓ Body: { pageId, format, includeMetadata }
Backend (NestJS - port 3000)
  ↓ 1. Validate JWT & extract user/workspace
  ↓ 2. Check CASL permissions
  ↓ 3. Check rate limit
  ↓ 4. Fetch page from database
  ↓ 5. Verify page belongs to workspace
  ↓ 6. Format content based on format parameter
  ↓ 7. Extract metadata (if requested)
  ↓ POST http://localhost:8000/api/document/read
  ↓ Headers: {
  ↓   X-API-Key: parth128,
  ↓   X-Workspace-Id: <workspace-id>,
  ↓   X-User-Id: <user-id>,
  ↓   X-Page-Id: <page-id>
  ↓ }
  ↓ Body: { pageId, title, content, format, metadata }
External AI Service (Python - port 8000)
  ↓ 1. Verify API key
  ↓ 2. Process document (currently returns as-is)
  ↓ 3. Return processed content
Backend (NestJS)
  ↓ Return response to frontend
Frontend (React)
  ↓ Receive formatted document content
```

## Example Usage

### Frontend (TypeScript/React)

```typescript
import api from "@/lib/api-client";

// Read document as text
const response = await api.post("/external-service/ai/document/read", {
  pageId: "123e4567-e89b-12d3-a456-426614174000",
  format: "text",
  includeMetadata: true,
});

console.log(response.data.content); // Plain text content
console.log(response.data.metadata.wordCount); // Word count
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/external-service/ai/document/read \
  -H "Content-Type: application/json" \
  -H "Cookie: authToken=YOUR_JWT_TOKEN" \
  -d '{
    "pageId": "123e4567-e89b-12d3-a456-426614174000",
    "format": "text",
    "includeMetadata": true
  }'
```

## Security

1. **JWT Authentication**: All requests require valid JWT token
2. **Workspace Context**: Automatically extracted from JWT
3. **Permission Check**: CASL-based permission validation
4. **Rate Limiting**: 30 requests/minute per user/workspace
5. **API Key Protection**: API key stored in backend, never exposed to frontend
6. **Workspace Validation**: Page must belong to the user's workspace

## External Service (Python) Endpoint

The backend forwards the request to:

```
POST http://localhost:8000/api/document/read
```

### Request to External Service

```json
{
  "pageId": "123e4567-e89b-12d3-a456-426614174000",
  "title": "My Document Title",
  "content": "Formatted content based on format parameter",
  "format": "text",
  "metadata": {
    "wordCount": 150,
    "characterCount": 850,
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-16T14:20:00Z",
    "author": "John Doe"
  }
}
```

### Response from External Service

```json
{
  "pageId": "123e4567-e89b-12d3-a456-426614174000",
  "title": "My Document Title",
  "content": "Processed content (can be same as input or AI-processed)",
  "format": "text",
  "metadata": { ... },
  "success": true
}
```

## Notes

- The external service currently returns content as-is, but can be extended to perform:
  - Content summarization
  - Content analysis
  - Content extraction
  - Content transformation
  - AI-powered insights

- The `markdown` format currently uses text format internally, but can be enhanced to provide proper Markdown conversion

