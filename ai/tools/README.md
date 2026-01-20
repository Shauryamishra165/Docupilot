# AI Tool Registry

## Overview

The AI Tool Registry allows the AI service to call back to the Docmost backend to perform actions like reading documents, analyzing content, and more. This enables the AI to have access to real-time document data and perform operations on behalf of the user.

## Architecture

```
User Message → AI Service (Python)
  ↓
AI decides to use a tool (e.g., read_document, vector_search)
  ↓
Tool Handler calls Backend API or Cloud AI Server
  ↓
Backend/Cloud AI validates & returns data
  ↓
Tool returns result to AI
  ↓
AI uses result to generate response
```

**Service Communication:**
- **Document Tools** → Backend API (port 3000) - for reading/writing documents
- **Vector Search Tools** → Cloud AI Server (port 3001) - for semantic search

## Context Passing

### How Page and Workspace Context is Passed

The AI service receives context through **HTTP headers** when the frontend calls the backend, and the backend forwards this context to the AI service:

1. **Frontend → Backend** (port 3000):
   - JWT token contains user and workspace info
   - Frontend can pass `pageId` in request body (optional)

2. **Backend → AI Service** (port 8000):
   - Headers automatically forwarded:
     - `X-Workspace-Id`: Current workspace ID
     - `X-User-Id`: Current user ID
     - `X-Page-Id`: Current page ID (if available)
   - Request body can also include `pageId` (takes precedence)

### Context in Tools

When a tool is executed, it receives a `context` dictionary containing:

```python
{
    "workspaceId": "uuid-of-workspace",
    "userId": "uuid-of-user",
    "pageId": "uuid-of-current-page"  # Optional, if user is viewing a page
}
```

Tools can use this context to:
- Know which workspace/user they're operating on
- Use the current page ID if not explicitly provided
- Make authenticated calls back to the backend

## Available Tools

### 1. `read_document`

Reads the content of a document/page.

**Parameters:**
- `pageId` (optional): UUID of the page to read. If not provided, uses current page from context.
- `format` (optional): Output format - `'text'`, `'html'`, `'json'`, `'markdown'` (default: `'text'`)
- `includeMetadata` (optional): Include page metadata (default: `False`)

**Example AI Usage:**
```
User: "What is this document about?"
AI: [Calls read_document tool automatically]
AI: "Based on the document content, this document is about..."
```

**Tool Handler Flow:**
1. Gets `pageId` from arguments or context
2. Calls backend API: `POST /api/external-service/ai/document/read`
3. Returns document content to AI
4. AI uses content to answer user's question

### 2. `vector_search`

Performs semantic/vector search across documents in the workspace to find relevant content based on a query. Uses embedding similarity search to find documents that are semantically similar to the query, even if they don't contain exact keywords.

**Parameters:**
- `query` (required): The search query or message to find semantically similar content
- `limit` (optional): Number of results to return (default: 10, min: 1, max: 100)
- `threshold` (optional): Similarity threshold 0-1 (default: 0.7). Lower = stricter matching

**Example AI Usage:**
```
User: "Find documents about authentication"
AI: [Calls vector_search tool automatically]
AI: "I found 5 relevant documents about authentication..."
```

**Tool Handler Flow:**
1. Gets `query` from arguments
2. Calls Cloud AI server: `POST http://localhost:3001/embeddings/search`
3. Uses API key authentication (`X-API-Key` header)
4. Returns semantically similar document chunks ranked by relevance
5. AI uses results to provide context-aware answers

## Adding New Tools

### Step 1: Create Tool Handler

Create a handler function in `ai/tools/`:

```python
def my_tool_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for my_tool
    
    Arguments:
        - param1: Description
        - param2: Description
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available)
    """
    # Get context
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    # Call backend API or perform operation
    # ...
    
    return {
        "result": "tool result"
    }
```

### Step 2: Register Tool

In `ai/tools/document_tools.py` (or create new file):

```python
def register_my_tools(registry: ToolRegistry):
    my_tool = ToolDefinition(
        name="my_tool",
        description="What this tool does",
        parameters={
            "type": "object",
            "properties": {
                "param1": {
                    "type": "string",
                    "description": "Parameter description"
                }
            }
        },
        handler=my_tool_handler
    )
    registry.register(my_tool)
```

### Step 3: Register in main.py

```python
from tools.my_tools import register_my_tools

# Register all tools
register_document_tools(tool_registry)
register_my_tools(tool_registry)  # Add this
```

## Backend API Requirements

When creating tools that call back to the backend:

1. **Authentication**: Use `X-API-Key` header with value from `EXTERNAL_SERVICE_API_KEY`
2. **Context Headers**: Include `X-Workspace-Id` and `X-User-Id` from context
3. **Endpoint**: Call endpoints under `/api/external-service/ai/...`
4. **Error Handling**: Return structured error responses

Example tool handler calling backend:

```python
def my_tool_handler(arguments, context):
    url = f"{BACKEND_URL}/api/external-service/ai/my-endpoint"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": BACKEND_API_KEY,
        "X-Workspace-Id": context["workspaceId"],
        "X-User-Id": context["userId"],
    }
    
    response = httpx.post(url, json=arguments, headers=headers)
    return response.json()
```

## Environment Variables

Add to `ai/.env`:

```bash
# Backend URL for tool callbacks
BACKEND_URL=http://localhost:3000

# Cloud AI Server URL for vector search
CLOUD_AI_URL=http://localhost:3001

# API key for backend and Cloud AI authentication (should match EXTERNAL_SERVICE_API_KEY in both services)
EXTERNAL_SERVICE_API_KEY=parth128

# Optional: Timeout for Cloud AI API requests (default: 30 seconds)
CLOUD_AI_API_TIMEOUT=30.0
```

## Function Calling Flow

1. **User sends message**: "What is this document about?"

2. **AI receives message** with context:
   - Workspace ID: `workspace-123`
   - User ID: `user-456`
   - Page ID: `page-789`

3. **AI decides to use tool**: Recognizes it needs document content

4. **AI calls `read_document` tool**:
   ```python
   # AI automatically calls:
   read_document(
       pageId="page-789",  # From context
       format="text"
   )
   ```

5. **Tool handler executes**:
   - Calls backend: `POST /api/external-service/ai/document/read`
   - Backend validates permissions
   - Backend returns document content

6. **Tool returns result to AI**:
   ```python
   {
       "pageId": "page-789",
       "title": "My Document",
       "content": "Document content here...",
       "success": True
   }
   ```

7. **AI uses result** to generate response:
   "Based on the document content, this document is about..."

## Security Considerations

1. **Context Validation**: Tools always receive validated context (workspace/user/page)
2. **Backend Authentication**: All tool calls use API key authentication
3. **Permission Checks**: Backend validates permissions before executing operations
4. **Rate Limiting**: Backend enforces rate limits on all operations
5. **Error Handling**: Tools handle errors gracefully and return structured responses

## Testing Tools

You can test tools directly:

```python
from tools.tool_registry import tool_registry
from tools.document_tools import register_document_tools

register_document_tools(tool_registry)

# Test tool
context = {
    "workspaceId": "test-workspace",
    "userId": "test-user",
    "pageId": "test-page"
}

result = tool_registry.execute_tool(
    "read_document",
    {"format": "text"},
    context
)

print(result)
```

## Tool Files

- **`document_tools.py`**: Document manipulation tools (read, replace, insert, etc.)
- **`vector_search_tools.py`**: Vector/semantic search tools (vector_search)

## Future Tools

Potential tools to add:
- `analyze_document`: AI-powered document analysis
- `summarize_document`: Generate document summaries
- `extract_key_points`: Extract key points from document
- `format_document`: Format document content

