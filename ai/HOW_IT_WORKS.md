# How AI Service Receives Context (Workspace ID, User ID, Page ID, Document Content)

## Data Flow

### 1. Frontend → Backend
**File**: `apps/client/src/features/editor/components/ai-sidebar/ai-sidebar.tsx`

```typescript
// Frontend extracts pageId from URL
const { pageSlug } = useParams();
const pageId = pageSlug ? extractPageSlugId(pageSlug) : undefined;

// Sends to backend with pageId in request body
const response = await api.post("/external-service/ai/chat", {
  messages: apiMessages,
  ...(pageId && { pageId }), // Include pageId if available
});
```

**What's sent:**
- `messages`: Array of chat messages
- `pageId`: Current page ID (extracted from URL)

**Authentication:**
- JWT token automatically included via `api` client
- Backend extracts workspace and user from JWT

### 2. Backend → AI Service (WITH Document Content)
**File**: `apps/server/src/integrations/external-service/ai-chat.service.ts`

```typescript
// Backend READS the document content BEFORE sending to AI service
// This way AI service doesn't need to call back (which would require JWT)
if (request.pageId) {
  const documentData = await this.fetchDocumentContent(request.pageId, workspace);
  if (documentData) {
    requestBody.documentTitle = documentData.title;
    requestBody.documentContent = documentData.content;
  }
}

// Backend forwards request to AI service with headers AND document content
const headers = {
  'X-API-Key': this.apiKey,
  'X-Workspace-Id': workspace.id,      // From JWT auth
  'X-User-Id': userId,                 // From JWT auth
  'X-Page-Id': request.pageId,        // From request body
};

const requestBody = {
  messages: request.messages,
  pageId: request.pageId,
  documentTitle: documentData.title,      // Document title (fetched by backend)
  documentContent: documentData.content,   // Document content (fetched by backend)
};
```

**What's sent:**
- Headers: `X-Workspace-Id`, `X-User-Id`, `X-Page-Id`, `X-API-Key`
- Body: `messages`, `pageId`, `documentTitle`, `documentContent`

### 3. AI Service Receives Context AND Document
**File**: `ai/main.py`

```python
class ChatRequest(BaseModel):
    messages: List[Message]
    pageId: Optional[str] = None
    documentTitle: Optional[str] = None    # Provided by backend
    documentContent: Optional[str] = None  # Provided by backend

@app.post("/api/chat")
async def chat(request: ChatRequest, ...):
    # Document content is already provided by backend
    if request.documentContent:
        # Enhance the user message with document context
        enhanced_message = f"""
Document Title: {request.documentTitle}
Document Content: {request.documentContent}
User Question: {last_message.content}
"""
```

**Context available:**
- `workspaceId`: Current workspace
- `userId`: Current user
- `pageId`: Current page/document
- `documentTitle`: Document title (provided by backend)
- `documentContent`: Full document text (provided by backend)

## Architecture: Backend Provides Document Content

**Why this approach?**
1. **No JWT in AI service**: AI service doesn't need to call back to backend
2. **Secure**: JWT stays in backend, API key is used for AI service
3. **Simple**: Single request flow, no callbacks
4. **Fast**: Document content is included in the same request

**Flow:**
```
Frontend (JWT) → Backend → [Reads Document] → AI Service (API Key)
                                ↑
                           Uses JWT auth
                           to read document
```

## Security

1. **Frontend → Backend**: JWT authentication (user session)
2. **Backend reads document**: Uses JWT permissions to verify access
3. **Backend → AI Service**: API key authentication (service-to-service)

The document content is only sent to AI service if:
- User has permission to read the document (verified by JWT)
- Document belongs to the current workspace

