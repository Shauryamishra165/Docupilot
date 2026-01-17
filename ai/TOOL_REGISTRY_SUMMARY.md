# Tool Registry Summary

## What Was Created

### 1. Tool Registry System (`ai/tools/`)

**Files Created:**
- `ai/tools/__init__.py` - Package initialization
- `ai/tools/tool_registry.py` - Core tool registry system
- `ai/tools/document_tools.py` - Document reading tool implementation
- `ai/tools/README.md` - Comprehensive tool documentation

### 2. Updated Files

**Backend (NestJS):**
- `apps/server/src/integrations/external-service/dto/ai-chat.dto.ts` - Added optional `pageId` field
- `apps/server/src/integrations/external-service/ai-chat.service.ts` - Passes `pageId` to AI service

**AI Service (Python):**
- `ai/main.py` - Integrated tool registry and function calling
- `ai/requirements.txt` - Added `httpx` dependency
- `ai/CONTEXT_PASSING.md` - Context passing documentation

## How It Works

### Context Passing Flow

```
User on Page → Frontend → Backend → AI Service
                                    ↓
                            Context Dictionary:
                            {
                              workspaceId: "...",
                              userId: "...",
                              pageId: "..." (if available)
                            }
                                    ↓
                            Tools receive context automatically
```

### Tool Execution Flow

1. **User asks**: "What is this document about?"
2. **AI receives** message with context (workspace, user, page)
3. **AI decides** to use `read_document` tool
4. **Tool handler** executes:
   - Gets `pageId` from context (no need to ask user)
   - Calls backend API: `POST /api/external-service/ai/document/read`
   - Returns document content
5. **AI uses** document content to answer user's question

## Key Components

### Tool Registry (`tool_registry.py`)

- **Purpose**: Central registry for all AI tools
- **Features**:
  - Register tools with name, description, parameters
  - List tools in Gemini function calling format
  - Execute tools with context

### Document Tool (`document_tools.py`)

- **Tool Name**: `read_document`
- **Purpose**: Read document content from backend
- **Parameters**:
  - `pageId` (optional): Uses context if not provided
  - `format`: 'text', 'html', 'json', 'markdown'
  - `includeMetadata`: Include page metadata

### Context Dictionary

Automatically created from HTTP headers:

```python
context = {
    "workspaceId": x_workspace_id,  # From X-Workspace-Id header
    "userId": x_user_id,            # From X-User-Id header
    "pageId": request.pageId or x_page_id,  # From body or X-Page-Id header
}
```

## How Page/Workspace ID is Known

### Method 1: HTTP Headers (Automatic)

When frontend calls backend:
- Backend extracts `workspaceId` and `userId` from JWT token
- Backend forwards these as headers to AI service:
  - `X-Workspace-Id`: Current workspace
  - `X-User-Id`: Current user
  - `X-Page-Id`: Current page (if frontend passes it)

### Method 2: Request Body (Explicit)

Frontend can explicitly pass `pageId` in request body:

```typescript
await api.post("/external-service/ai/chat", {
  messages: [...],
  pageId: currentPageId  // Explicit page ID
});
```

### Priority

1. **Request body `pageId`** (highest priority)
2. **`X-Page-Id` header** (if provided)
3. **Context `pageId`** (if available)

## Usage Example

### Frontend Integration

```typescript
// In ai-sidebar.tsx
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";

const { pageSlug } = useParams();
const pageId = extractPageSlugId(pageSlug);

const handleSend = async () => {
  const response = await api.post("/external-service/ai/chat", {
    messages: [
      { role: "user", content: "What is this document about?" }
    ],
    pageId: pageId  // Pass current page ID
  });
  
  // AI automatically uses read_document tool
  // No need to explicitly call it
};
```

### AI Behavior

**User**: "What is this document about?"

**AI automatically**:
1. Recognizes it needs document content
2. Calls `read_document` tool (uses `pageId` from context)
3. Receives document content
4. Generates response: "Based on the document, it's about..."

**No user interaction needed** - AI knows which page from context!

## Adding New Tools

### Step 1: Create Handler

```python
# ai/tools/my_tool.py
def my_tool_handler(arguments, context):
    workspace_id = context["workspaceId"]
    user_id = context["userId"]
    page_id = context.get("pageId")
    
    # Use context to call backend
    # ...
    
    return {"result": "..."}
```

### Step 2: Register Tool

```python
# In ai/tools/my_tool.py
def register_my_tools(registry):
    tool = ToolDefinition(
        name="my_tool",
        description="What it does",
        parameters={...},
        handler=my_tool_handler
    )
    registry.register(tool)
```

### Step 3: Register in main.py

```python
from tools.my_tool import register_my_tools

register_my_tools(tool_registry)
```

## Environment Variables

Add to `ai/.env`:

```bash
# Backend URL for tool callbacks
BACKEND_URL=http://localhost:3000

# API key (should match backend's EXTERNAL_SERVICE_API_KEY)
EXTERNAL_SERVICE_API_KEY=parth128
```

## Security

1. **Context Validation**: All context comes from validated JWT
2. **API Key**: Tools use API key to authenticate with backend
3. **Permission Checks**: Backend validates permissions before operations
4. **Rate Limiting**: Backend enforces rate limits
5. **Isolation**: Each request has isolated context

## Benefits

✅ **Seamless UX**: User doesn't need to specify page ID  
✅ **Context Awareness**: AI knows current workspace/user/page  
✅ **Automatic Tool Usage**: AI uses tools without asking  
✅ **Extensible**: Easy to add new tools  
✅ **Secure**: All context validated and authenticated  

## Next Steps

1. **Test the tool registry**: Send a message asking about the document
2. **Add more tools**: Write, format, analyze, etc.
3. **Frontend integration**: Pass `pageId` from AI sidebar
4. **Error handling**: Improve error messages for tool failures

## Files to Review

- `ai/tools/README.md` - Complete tool documentation
- `ai/CONTEXT_PASSING.md` - Context passing details
- `ai/tools/tool_registry.py` - Core registry implementation
- `ai/tools/document_tools.py` - Document tool example

