# Context Passing: Page ID and Workspace ID

## Overview

This document explains how the AI service receives context about the current page and workspace, enabling it to use tools like `read_document` without requiring the user to explicitly provide page IDs.

## Context Flow

```
┌─────────────┐
│  Frontend   │
│  (React)    │
└──────┬──────┘
       │ POST /api/external-service/ai/chat
       │ Headers: { Cookie: JWT }
       │ Body: { 
       │   messages: [...],
       │   pageId: "current-page-id" (optional)
       │ }
       ▼
┌─────────────────────────────────────┐
│  NestJS Backend (port 3000)         │
│  ┌───────────────────────────────┐ │
│  │ 1. Extract from JWT:          │ │
│  │    - workspace.id             │ │
│  │    - user.id                   │ │
│  │ 2. Get pageId from:            │ │
│  │    - Request body (if provided)│ │
│  │    - Current page context      │ │
│  └───────────────────────────────┘ │
└──────┬──────────────────────────────┘
       │ POST http://localhost:8000/api/chat
       │ Headers: {
       │   X-API-Key: parth128,
       │   X-Workspace-Id: <workspace-id>,
       │   X-User-Id: <user-id>,
       │   X-Page-Id: <page-id> (if available)
       │ }
       │ Body: {
       │   messages: [...],
       │   pageId: <page-id> (if provided)
       │ }
       ▼
┌─────────────────────────────────────┐
│  Python AI Service (port 8000)     │
│  ┌───────────────────────────────┐ │
│  │ Context Dictionary:            │ │
│  │ {                              │ │
│  │   "workspaceId": "...",        │ │
│  │   "userId": "...",             │ │
│  │   "pageId": "..." (optional)   │ │
│  │ }                              │ │
│  │                                │ │
│  │ Tools receive this context     │ │
│  │ automatically                  │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

## How Context is Determined

### 1. Workspace ID
- **Source**: Automatically extracted from JWT token
- **Location**: `@AuthWorkspace()` decorator in controller
- **Always Available**: Yes (required for all authenticated requests)

### 2. User ID
- **Source**: Automatically extracted from JWT token
- **Location**: `@AuthUser()` decorator in controller
- **Always Available**: Yes (required for all authenticated requests)

### 3. Page ID
- **Source 1**: Request body `pageId` field (explicit)
- **Source 2**: Current page context from frontend
- **Location**: Optional parameter in `AiChatRequestDto`
- **Always Available**: No (only when user is viewing a page)

## Frontend Integration

### Option 1: Pass pageId in Request Body (Recommended)

When the user is on a page and opens the AI sidebar:

```typescript
// In ai-sidebar.tsx
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";

const { pageSlug } = useParams();
const pageId = extractPageSlugId(pageSlug);

const handleSend = async () => {
  const response = await api.post("/external-service/ai/chat", {
    messages: apiMessages,
    pageId: pageId, // Pass current page ID
  });
};
```

### Option 2: Backend Extracts from Context

If the frontend doesn't pass `pageId`, the backend could extract it from:
- URL parameters
- Session storage
- Current page state

**Note**: Currently, the backend requires explicit `pageId` in the request body.

## AI Service Context Usage

When the AI service receives a request, it creates a context dictionary:

```python
context = {
    "workspaceId": x_workspace_id,  # From header
    "userId": x_user_id,            # From header
    "pageId": request.pageId or x_page_id,  # From body or header
}
```

This context is automatically passed to all tool handlers.

## Tool Usage with Context

### Example: read_document Tool

**User asks**: "What is this document about?"

**AI automatically:**
1. Recognizes it needs document content
2. Calls `read_document` tool
3. Tool uses `pageId` from context (no need to ask user)
4. Tool calls backend API with context
5. Returns document content to AI
6. AI generates response based on content

**Tool Handler Code:**
```python
def read_document_handler(arguments, context):
    # Get pageId from arguments or context
    page_id = arguments.get("pageId") or context.get("pageId")
    
    # Use context for authentication
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    # Call backend API
    # ...
```

## Benefits

1. **Seamless UX**: User doesn't need to specify page ID
2. **Context Awareness**: AI knows which page user is viewing
3. **Automatic Tool Usage**: AI can use tools without asking for context
4. **Security**: Context is validated and comes from authenticated sources

## Security Considerations

1. **JWT Validation**: Workspace and user IDs come from validated JWT
2. **Permission Checks**: Backend validates user has access to the page
3. **Context Isolation**: Each request has its own context (no cross-contamination)
4. **API Key Protection**: Tool calls use API key authentication

## Future Enhancements

1. **Multiple Page Context**: Support reading multiple pages
2. **Space Context**: Include space information
3. **Document History**: Access to document version history
4. **Related Documents**: Access to related/linked documents

