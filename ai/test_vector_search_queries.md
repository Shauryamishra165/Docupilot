# Test Queries for Vector Search/RAG API

## Purpose
These queries test whether the AI model can:
1. Successfully call the `vector_search` tool
2. Access `workspace_id` and `page_id` from context
3. Perform semantic search within a page or across the workspace

## Test Queries

### Test 1: Basic Vector Search (Workspace-wide)
**Query:**
```
Search for documents about authentication using semantic search
```

**Expected Behavior:**
- AI should call `vector_search` tool
- Should search across entire workspace (no pageId)
- Should return semantically similar content

**What to Check:**
- Logs should show: `[TOOL: vector_search] Starting vector search operation`
- Logs should show: `PageId: not provided (searching entire workspace)`
- Context should include: `workspaceId` and `userId`
- Should successfully call Cloud AI server at `http://localhost:3001/embeddings/search`

---

### Test 2: Page-Specific Vector Search
**Query:**
```
Find related content in this page about user management using semantic search
```

**Expected Behavior:**
- AI should call `vector_search` tool
- Should use `pageId` from context (current page)
- Should search only within that page's chunks

**What to Check:**
- Logs should show: `[TOOL: vector_search] PageId: <page-id> (searching within this page only)`
- Context should include: `workspaceId`, `userId`, and `pageId`
- Request to Cloud AI should include `pageId` in payload

---

### Test 3: Explicit Page ID Search
**Query:**
```
Use semantic search to find information about API endpoints in page knURy5rOpJ
```

**Expected Behavior:**
- AI should call `vector_search` tool with explicit `pageId`
- Should search only within specified page

**What to Check:**
- Logs should show the explicit pageId being used
- Request payload should include `pageId: "knURy5rOpJ"`

---

### Test 4: Summary Using Semantic Search
**Query:**
```
Give me a summary of this page using semantic search tools to find related content
```

**Expected Behavior:**
- AI should call `vector_search` tool first
- Should use `pageId` from context
- Should then provide a summary based on search results

**What to Check:**
- Multiple tool calls: `vector_search` followed by summary generation
- Context should be passed correctly to all tools

---

### Test 5: Cross-Document Search
**Query:**
```
Find all documents that discuss database migrations using semantic search
```

**Expected Behavior:**
- AI should call `vector_search` tool
- Should NOT include pageId (searches entire workspace)
- Should return results from multiple pages

**What to Check:**
- Logs should show: `PageId: not provided (searching entire workspace)`
- Results should include chunks from different pages

---

### Test 6: Context Verification Query
**Query:**
```
What is my current workspace ID and page ID? Use semantic search to find documents related to workspace management.
```

**Expected Behavior:**
- AI should call `vector_search` tool
- Should have access to workspaceId and pageId from context
- Should use them in the API call

**What to Check:**
- Logs should show context values: `workspace={workspaceId}, user={userId}, page={pageId}`
- Cloud AI server should receive `X-Workspace-Id` header
- If pageId exists, should receive `X-Page-Id` header

---

## How to Verify Context Passing

### Check AI Service Logs
Look for these log entries:
```
[TOOL EXECUTION] Context: workspace=<workspace-id>, user=<user-id>, page=<page-id>
[TOOL: vector_search] Context: workspace=<workspace-id>, user=<user-id>, page=<page-id>
```

### Check Cloud AI Server Logs
Look for these log entries:
```
Generating embeddings with context: workspace=<workspace-id>, user=<user-id>, page=<page-id>
Similarity search with context: workspace=<workspace-id>, user=<user-id>, pageId=<page-id>
```

### Check Request Headers
The Cloud AI server should receive:
- `X-API-Key`: API key for authentication
- `X-Workspace-Id`: Workspace ID (required)
- `X-User-Id`: User ID (optional, for tracking)
- `X-Page-Id`: Page ID (optional, if searching within a page)

### Check Request Payload
The request body should include:
```json
{
  "query": "your search query",
  "limit": 10,
  "threshold": 0.7,
  "pageId": "optional-page-id"  // Only if searching within a page
}
```

---

## Troubleshooting

### Issue: "Unknown field for Schema: minimum"
**Solution:** ✅ Fixed - Schema cleaning now removes `minimum` and `maximum` fields

### Issue: Tool not being called
**Check:**
- Are tools registered? Look for: `[TOOL REGISTRY] - Tool: vector_search`
- Is function calling enabled? Look for: `[LLM] Function calling enabled`
- Check for errors: `[LLM] Error sending message`

### Issue: Context missing
**Check:**
- Are headers being passed? Look for: `[CHAT REQUEST] Workspace ID: ...`
- Is context being built? Look for: `[CONTEXT] Page ID available: ...`
- Check context in tool execution: `[TOOL EXECUTION] Context: ...`

### Issue: API call failing
**Check:**
- Is Cloud AI server running on port 3001?
- Is API key correct? Check `EXTERNAL_SERVICE_API_KEY` in `.env`
- Check Cloud AI server logs for authentication errors
- Verify CORS is configured correctly

---

## Expected Log Flow

### Successful Vector Search Call:
```
[TOOL REGISTRY] Executing tool: vector_search
[TOOL: vector_search] Starting vector search operation
[TOOL: vector_search] Context: workspace=<id>, user=<id>, page=<id>
[TOOL: vector_search] Query: 'your query'
[TOOL: vector_search] PageId: <id> (searching within this page only) OR (searching entire workspace)
[TOOL: vector_search] Calling Cloud AI server: http://localhost:3001/embeddings/search
[TOOL: vector_search] Cloud AI server response status: 200
[TOOL: vector_search] Found X results
[TOOL: vector_search] Operation completed in X.XXs
```

---

## Quick Test Commands

### Test via API (using curl):
```bash
# Test with page context
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: parth128" \
  -H "X-Workspace-Id: your-workspace-id" \
  -H "X-User-Id: your-user-id" \
  -H "X-Page-Id: your-page-id" \
  -d '{
    "messages": [
      {"role": "user", "content": "Find related content in this page about authentication using semantic search"}
    ],
    "pageId": "your-page-id"
  }'
```

### Test without page context (workspace-wide):
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-API-Key: parth128" \
  -H "X-Workspace-Id: your-workspace-id" \
  -H "X-User-Id: your-user-id" \
  -d '{
    "messages": [
      {"role": "user", "content": "Search for documents about database migrations using semantic search"}
    ]
  }'
```

