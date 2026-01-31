# AI Agent Streaming - Quick Start Guide

## What Changed?

The AI agent now streams responses in real-time and shows exactly what it's doing. Users can preview and accept/reject changes before they're applied to the document.

## Key Features

### 1. Real-Time Streaming ✨
- See AI responses as they're generated
- Watch tool calls execute in real-time
- No more "Thinking..." black box

### 2. Tool Call Visualization 🔧
- Shows which tools are being called
- Displays execution status (pending → executing → completed)
- Shows results of each tool

### 3. Preview Mode 👁️
- **Enabled** (default): Changes are proposed first
- **Disabled**: Changes are applied immediately
- Toggle in AI sidebar header

### 4. Change Tracker 📋
- Floating panel showing all proposed changes
- Accept/reject individual changes
- Bulk actions (Accept All / Reject All)
- Shows before/after for replacements

### 5. Real-Time Collaboration 🤝
- Changes sync instantly via Yjs
- All connected users see updates
- Works with existing collaboration system

---

## For Users

### How to Use

1. **Open AI Sidebar**
   - Click AI icon in editor toolbar
   
2. **Enable Preview Mode (Optional)**
   - Toggle "Preview changes" in sidebar header
   - When ON: Review changes before applying
   - When OFF: Changes apply immediately

3. **Chat with AI**
   - Type your request
   - Press Enter or click Send
   - Watch the streaming response

4. **Review Changes (Preview Mode)**
   - Change tracker appears at bottom-right
   - Each change shows:
     - Type (insert/replace/delete/format)
     - Description
     - Before/after preview
   - Click ✓ to accept or ✗ to reject
   - Use "Accept All" or "Reject All" for bulk actions

### Examples

**Example 1: Simple Edit**
```
You: "Add a conclusion section"
AI: 🔧 insert_content
    ✓ insert_content
    "I've added a conclusion section to your document"
```

**Example 2: Find and Replace**
```
You: "Change API to RESTful API everywhere"
AI: 🔧 find_and_replace
    ✓ find_and_replace
    "I've replaced 5 occurrences of 'API' with 'RESTful API'"
```

**Example 3: With Preview Mode**
```
You: "Make the introduction bold"
AI: [Change Tracker appears]
    📋 format - Apply bold formatting
    Preview: "Introduction" → "**Introduction**"
    [✓ Accept] [✗ Reject]
[You click Accept]
AI: ✓ Applied bold formatting
```

---

## For Developers

### Files Changed

**Python AI Service:**
- `ai/agents/document_agent.py` - Added streaming support
- `ai/main.py` - Added `/api/chat/stream` endpoint

**NestJS Backend:**
- `apps/server/src/integrations/external-service/ai-chat.service.ts` - Streaming proxy
- `apps/server/src/integrations/external-service/external-service.controller.ts` - SSE endpoint

**React Frontend:**
- `apps/client/src/features/editor/components/ai-sidebar/ai-sidebar.tsx` - SSE client, UI updates
- `apps/client/src/features/ai/services/tool-executor.ts` - Preview mode, change tracking
- `apps/client/src/features/ai/components/ai-change-tracker.tsx` - NEW: Change tracker UI

### API Changes

**New Endpoint:**
```
POST /api/external-service/ai/chat/stream
Content-Type: application/json
Returns: text/event-stream

Request:
{
  "messages": [
    {"role": "user", "content": "..."}
  ],
  "pageId": "..." (optional)
}

Response (SSE):
event: message
data: {"type": "message", "content": "..."}

event: tool_calls
data: {"type": "tool_calls", "tool_calls": [...]}

event: tool_result
data: {"type": "tool_result", "tool_name": "...", "content": "..."}

event: pending_tools
data: {"type": "pending_tools", "tools": [...]}

event: done
data: {"chatId": "..."}

event: error
data: {"error": "..."}
```

### Integration Points

**1. Tool Executor**
```typescript
// Enable preview mode
toolExecutor.setPreviewMode(true);

// Listen for changes
toolExecutor.onChangeProposed((change) => {
  console.log('Change proposed:', change);
});

// Accept a change
toolExecutor.applyChange(changeId);

// Reject a change
toolExecutor.rejectChange(changeId);
```

**2. Change Tracker**
```typescript
<AiChangeTracker
  editor={editor}
  changes={proposedChanges}
  onAccept={handleAcceptChange}
  onReject={handleRejectChange}
  onAcceptAll={handleAcceptAllChanges}
  onRejectAll={handleRejectAllChanges}
/>
```

**3. SSE Streaming**
```typescript
const response = await fetch("/api/external-service/ai/chat/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages, pageId }),
  credentials: "include",
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value, { stream: true });
  // Parse SSE format: "event: type\ndata: {...}\n\n"
  // Handle events...
}
```

---

## Testing

### Test Streaming

1. Open browser DevTools → Network tab
2. Send a message in AI sidebar
3. Look for request to `/ai/chat/stream`
4. Content-Type should be `text/event-stream`
5. Watch events arrive in real-time

### Test Preview Mode

1. Enable "Preview changes" toggle
2. Ask AI to make a change (e.g., "Add a heading")
3. Verify change tracker appears
4. Test accept/reject buttons
5. Verify changes apply/don't apply correctly

### Test Collaboration

1. Open same document in two browser windows
2. Use AI in one window
3. Verify changes appear in both windows
4. Check Yjs connection status (should be "connected")

### Test Tool Calls

1. Watch AI sidebar while making requests
2. Tool calls should appear with status indicators
3. Status flow: pending → executing → completed
4. Results should be displayed

---

## Common Issues

### Streaming not working
- Check Python service is running (port 8000)
- Verify API keys match in both services
- Check browser console for CORS errors
- Inspect Network tab for failed requests

### Changes not syncing
- Check Yjs connection status in editor
- Verify collaboration gateway is running
- Refresh the page and try again

### Tool calls not executing
- Ensure editor instance is available
- Check console for tool execution errors
- Verify preview mode state

### Change tracker not appearing
- Preview mode must be enabled
- Changes must be pending
- Check React DevTools for component state

---

## Environment Setup

### Python AI Service (.env)
```env
GEMINI_API_KEY=your-gemini-api-key
BACKEND_URL=http://localhost:3000
EXTERNAL_SERVICE_API_KEY=your-api-key
BACKEND_API_TIMEOUT=120.0
```

### NestJS Backend (.env)
```env
EXTERNAL_SERVICE_URL=http://localhost:8000
EXTERNAL_SERVICE_API_KEY=your-api-key
EXTERNAL_SERVICE_TIMEOUT=240000
```

---

## Performance Tips

1. **SSE is efficient** - No polling, server pushes updates
2. **Tool execution is async** - Doesn't block the UI
3. **Yjs handles conflicts** - Multiple users can work simultaneously
4. **Preview mode** - Reduces unnecessary document updates

---

## Next Steps

1. Test the implementation thoroughly
2. Monitor logs for errors
3. Gather user feedback
4. Consider adding keyboard shortcuts
5. Add analytics for AI usage patterns

---

## Support

For issues or questions:
1. Check this guide first
2. Review `AI_STREAMING_IMPLEMENTATION.md` for details
3. Check console logs for errors
4. Verify all services are running
5. Test with simple queries first

Happy coding! 🚀
