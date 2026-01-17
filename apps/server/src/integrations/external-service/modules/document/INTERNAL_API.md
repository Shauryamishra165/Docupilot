# Internal API for AI Service

## Overview

The Internal API provides secure service-to-service communication between the AI service and the backend. It uses API key authentication instead of JWT, allowing the AI service to call back to the backend for operations like reading documents.

## Endpoint

**URL**: `/api/internal/ai/document/read`  
**Method**: `POST`  
**Authentication**: API Key (via `X-API-Key` header)

## Authentication

### API Key
- **Header**: `X-API-Key`
- **Environment Variable**: `EXTERNAL_SERVICE_API_KEY`
- **Location**: Backend `.env` file
- **Usage**: Service-to-service authentication (AI service → Backend)

### Context Headers
The AI service must provide workspace and user context:

- `X-Workspace-Id`: Current workspace ID
- `X-User-Id`: Current user ID

These headers are automatically included by the AI service based on the context from the original request.

## Request Format

```json
POST /api/internal/ai/document/read
Headers:
  X-API-Key: <api-key-from-env>
  X-Workspace-Id: <workspace-id>
  X-User-Id: <user-id>
  Content-Type: application/json

Body:
{
  "pageId": "uuid-of-page",
  "format": "text",  // optional: "text" | "html" | "json" | "markdown"
  "includeMetadata": false  // optional: boolean
}
```

## Response Format

```json
{
  "pageId": "uuid-of-page",
  "title": "Document Title",
  "content": "Formatted document content...",
  "format": "text",
  "metadata": {
    "wordCount": 1234,
    "characterCount": 5678,
    "createdAt": "2025-01-17T00:00:00.000Z",
    "updatedAt": "2025-01-17T00:00:00.000Z",
    "author": "User Name"
  },
  "success": true
}
```

## Security

1. **API Key Validation**: Backend validates the API key from environment variable
2. **Workspace Validation**: Backend verifies workspace exists
3. **User Validation**: Backend verifies user exists in workspace
4. **Permission Checks**: DocumentService still validates page access and permissions

## Usage in AI Service

The AI service tool (`read_document`) automatically uses this endpoint:

```python
# ai/tools/document_tools.py
url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/read"
headers = {
    "X-API-Key": BACKEND_API_KEY,
    "X-Workspace-Id": workspace_id,
    "X-User-Id": user_id,
}
```

## Environment Variables

### Backend (.env)
```bash
EXTERNAL_SERVICE_API_KEY=your-secure-api-key-here
```

### AI Service (ai/.env)
```bash
BACKEND_INTERNAL_URL=http://localhost:3000  # Optional, defaults to BACKEND_URL
EXTERNAL_SERVICE_API_KEY=your-secure-api-key-here  # Must match backend
```

## Differences from Public API

| Feature | Public API (`/api/external-service/ai/document/read`) | Internal API (`/api/internal/ai/document/read`) |
|---------|------------------------------------------------------|------------------------------------------------|
| Authentication | JWT Token | API Key |
| Access | Frontend/User requests | AI Service only |
| Context | From JWT token | From headers |
| Use Case | Direct user requests | Service-to-service calls |

## Future Extensions

This internal API can be extended for other operations:
- `/api/internal/ai/document/write` - Write/update documents
- `/api/internal/ai/document/search` - Search documents
- `/api/internal/ai/document/list` - List documents

All will use the same API key authentication pattern.

