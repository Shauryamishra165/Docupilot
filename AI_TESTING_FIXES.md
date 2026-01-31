# AI Agent Fixes - Testing Guide

## Issues Fixed

### 1. Preview Mode Default
**Problem:** Preview mode was enabled by default, preventing immediate execution
**Fix:** Changed default to `false` in `ai-sidebar.tsx`
```typescript
const [previewMode, setPreviewMode] = useState(false); // Now disabled by default
```

### 2. Tool Execution
**Problem:** Tool calls weren't executing properly on frontend
**Fix:** 
- Added comprehensive logging in tool execution
- Fixed tool executor initialization
- Added status updates for each tool

### 3. Streaming Implementation
**Problem:** SSE streaming had implementation issues
**Fix:**
- Removed incorrect EventSource usage
- Fixed SSE parsing (event type + data format)
- Added proper buffering and line splitting
- Better error handling

### 4. LangGraph Streaming
**Problem:** Agent streaming wasn't using correct LangGraph patterns
**Fix:**
- Changed to `stream_mode="updates"` (recommended by LangGraph docs)
- Added detailed logging for each stream event
- Properly extracts pending_tool_calls from state

---

## How to Test

### 1. Check Backend Streaming

**Start Python service with logging:**
```bash
cd ai
python main.py
```

**Watch for these logs:**
```
[CHAT STREAM] Starting streaming chat
[CHAT STREAM] Starting agent stream...
[DocumentAgent STREAM] Starting astream...
[DocumentAgent STREAM] Chunk keys: ['llm_call']
[DocumentAgent STREAM] Node: llm_call
[DocumentAgent STREAM] Has tool calls: True
[DocumentAgent STREAM] Yielding tool_calls: ['find_and_replace']
[DocumentAgent STREAM] Chunk keys: ['tools']
[DocumentAgent STREAM] Yielding pending_tools: 1
[DocumentAgent STREAM] Stream completed
[CHAT STREAM] Yielding event #1: tool_calls
[CHAT STREAM] Yielding event #2: pending_tools
[CHAT STREAM] Yielding event #3: message
[CHAT STREAM] Sending done event
```

### 2. Check Frontend Streaming

**Open Browser DevTools Console and look for:**
```
[AiSidebar] Starting streaming request...
[AiSidebar] Event type: tool_calls
[AiSidebar] Received event: tool_calls {tool_calls: Array(1)}
[AiSidebar] Adding tool calls: [{name: 'find_and_replace'}]
[AiSidebar] Event type: pending_tools
[AiSidebar] Executing pending tools: [{tool: 'find_and_replace', ...}]
[AiSidebar] Executing tool: {tool: 'find_and_replace', ...}
[AiSidebar] Tool find_and_replace executed: true
[AiSidebar] Event type: message
[AiSidebar] Received event: message {content: "..."}
[AiSidebar] Stream completed
```

### 3. Check Network Tab

1. Open DevTools → Network tab
2. Send a message in AI sidebar
3. Look for request to `/external-service/ai/chat/stream`
4. Check:
   - **Method:** POST
   - **Status:** 200
   - **Content-Type:** text/event-stream
   - **Response:** Should show streaming events

**Example SSE response:**
```
event: tool_calls
data: {"type":"tool_calls","tool_calls":[{"name":"find_and_replace","args":{...}}]}

event: pending_tools
data: {"type":"pending_tools","tools":[{...}]}

event: message
data: {"type":"message","content":"I've changed..."}

event: done
data: {"chatId":"..."}
```

### 4. Check Tool Execution

**Test command:**
```
"Change www.vlsfinance.com to www.hero.com"
```

**Expected behavior:**
1. AI sidebar shows tool call: "🔧 find_and_replace (executing)"
2. Tool status updates to: "✓ find_and_replace (completed)"
3. Editor content updates in real-time
4. Message: "I've changed all occurrences..."

**Verify in editor:**
- All instances of "www.vlsfinance.com" should be replaced with "www.hero.com"
- Changes should be visible immediately
- Other users (if connected) should see the changes

---

## Common Issues & Solutions

### Issue: "I attempted to perform the action, but encountered an issue"

**Cause:** Tool executor not executing tools

**Check:**
1. Is `toolExecutor` initialized? Check console: `ToolExecutor requires an editor instance`
2. Is editor instance passed to AI sidebar?
3. Are there any errors in console when executing tool?

**Solution:**
- Check browser console for detailed error logs
- Verify editor prop is passed to `<AiSidebar editor={editor} />`
- Check that tool parameters match expected format

### Issue: Tool calls not visible

**Cause:** Streaming not working or parsing error

**Check:**
1. Network tab shows `/chat/stream` (not `/chat`)
2. Content-Type is `text/event-stream`
3. Response is streaming (not complete)

**Solution:**
- Check backend logs for streaming errors
- Verify SSE format in Network tab
- Check browser console for parsing errors

### Issue: Changes not appearing in editor

**Cause:** Tool execution failing silently

**Check:**
1. Console logs for tool execution: `[AiSidebar] Tool find_and_replace executed: true/false`
2. ToolExecutor logs: `[ToolExecutor] findAndReplace: Found X match(es)`
3. Editor has focus and is editable

**Solution:**
- Ensure search text exists in document
- Check that editor is not in read-only mode
- Try simpler text replacement first

### Issue: Streaming stops/hangs

**Cause:** Backend error or timeout

**Check:**
1. Python logs for errors
2. Network tab for failed request
3. Browser console for fetch errors

**Solution:**
- Check Python service is running
- Verify API keys match
- Check for timeout errors (increase timeout if needed)

---

## Debug Checklist

- [ ] Python service running on port 8000
- [ ] NestJS backend running on port 3000
- [ ] React frontend running on port 5173
- [ ] All services can communicate
- [ ] API keys match in all services
- [ ] Browser console shows no CORS errors
- [ ] Network tab shows streaming request
- [ ] Backend logs show streaming events
- [ ] Frontend logs show SSE parsing
- [ ] Tool executor is initialized
- [ ] Editor is editable and has content

---

## Test Cases

### Test 1: Simple Find and Replace
```
User: "Change API to REST API everywhere"
Expected:
- Tool call: find_and_replace visible
- Editor updates with all replacements
- Success message confirms number of changes
```

### Test 2: Insert Content
```
User: "Add a conclusion section"
Expected:
- Tool call: insert_content visible
- New content appears at end of document
- Success message confirms insertion
```

### Test 3: Apply Formatting
```
User: "Make the word 'Important' bold"
Expected:
- Tool call: apply_formatting visible
- Word becomes bold in editor
- Success message confirms formatting
```

### Test 4: Multiple Operations
```
User: "Fix spelling of 'recieve' to 'receive' and make all headings bold"
Expected:
- Multiple tool calls visible
- All operations execute in sequence
- Success message for each operation
```

---

## Performance Expectations

- **Stream latency:** < 100ms per event
- **Tool execution:** < 50ms per tool
- **Total response time:** 2-5 seconds for typical queries
- **Yjs sync:** < 100ms to other clients

---

## Logs to Watch

### Python (AI Service)
```bash
tail -f logs.txt  # If logging to file
# Or just watch the terminal output
```

**Key indicators:**
- `[CHAT STREAM] Starting agent stream...`
- `[DocumentAgent STREAM] Yielding tool_calls:`
- `[DocumentAgent STREAM] Yielding pending_tools:`
- `[CHAT STREAM] Sending done event`

### Frontend (Browser Console)
**Filter by:** `AiSidebar`

**Key indicators:**
- `Starting streaming request...`
- `Executing pending tools:`
- `Tool X executed: true`
- `Stream completed`

---

## Quick Verification Script

Save as `test_streaming.py`:

```python
import requests
import json

API_KEY = "parth128"
BACKEND_URL = "http://localhost:3000"

headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
    "X-Workspace-Id": "test-workspace",
    "X-User-Id": "test-user",
}

data = {
    "messages": [
        {"role": "user", "content": "Change API to REST API"}
    ],
    "pageId": "test-page"
}

print("Testing streaming endpoint...")
response = requests.post(
    f"{BACKEND_URL}/api/external-service/ai/chat/stream",
    headers=headers,
    json=data,
    stream=True
)

print(f"Status: {response.status_code}")
print(f"Content-Type: {response.headers.get('content-type')}")
print("\nStreaming events:\n")

for line in response.iter_lines():
    if line:
        decoded = line.decode('utf-8')
        print(decoded)
```

Run: `python test_streaming.py`

Expected output:
```
Testing streaming endpoint...
Status: 200
Content-Type: text/event-stream

Streaming events:

event: tool_calls
data: {"type":"tool_calls",...}

event: pending_tools
data: {"type":"pending_tools",...}

event: message
data: {"type":"message",...}

event: done
data: {"chatId":"..."}
```

---

## Success Criteria

✅ Backend streams events in real-time
✅ Frontend receives and parses SSE correctly
✅ Tool calls are visible in UI
✅ Tools execute and update editor
✅ Changes sync via Yjs to other clients
✅ Error messages are clear and actionable
✅ No console errors or warnings
✅ Streaming completes with "done" event

---

## Next Steps After Fixes

1. **Test thoroughly** with different queries
2. **Monitor logs** for any errors
3. **Test collaboration** - open in 2 browsers
4. **Try complex queries** - multiple operations
5. **Check performance** - response times
6. **User testing** - get feedback on UX

---

## Support

If issues persist:
1. Check all logs (Python, NestJS, Browser)
2. Verify environment variables
3. Test with simple queries first
4. Check network connectivity
5. Review code changes in this session
