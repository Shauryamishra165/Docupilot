# AI Sidebar Complete Flow Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Complete Flow Step-by-Step](#complete-flow-step-by-step)
4. [Tool Execution System](#tool-execution-system)
5. [Change Preview & Acceptance](#change-preview--acceptance)
6. [Formatting & Editor Integration](#formatting--editor-integration)
7. [Real-time Updates with Yjs](#real-time-updates-with-yjs)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The AI Sidebar is a **real-time collaborative AI assistant** that can:
- **Read and understand** document content
- **Make intelligent edits** (insert, replace, delete, format)
- **Stream responses** in real-time
- **Show tool calls** as they execute
- **Preview changes** before applying them
- **Integrate with Yjs** for real-time collaboration

---

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│                     1. FRONTEND (React)                      │
│  - AI Sidebar UI (chat interface)                           │
│  - Tool Executor (executes changes in Tiptap editor)        │
│  - Change Tracker (preview & accept/reject)                 │
└────────────────────┬────────────────────────────────────────┘
                     │ SSE Streaming (Server-Sent Events)
                     │ Fetch API
┌────────────────────▼────────────────────────────────────────┐
│                  2. BACKEND (NestJS)                         │
│  - Proxy Layer                                              │
│  - Authentication & Rate Limiting                           │
│  - Stream forwarding                                        │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/SSE
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 3. AI SERVICE (Python/FastAPI)               │
│  - LangGraph Agent (orchestration)                          │
│  - Gemini 2.5 Flash (LLM)                                   │
│  - Tools (vector search, document operations)               │
└─────────────────────────────────────────────────────────────┘
```

---

## Complete Flow Step-by-Step

### Step 1: User Sends Message

**Location**: `apps/client/src/features/editor/components/ai-sidebar/ai-sidebar.tsx`

```typescript
const handleSend = async () => {
  // 1. Create user message
  const userMessage: Message = {
    id: Date.now().toString(),
    role: "user",
    content: input.trim(),
    timestamp: new Date(),
  };

  // 2. Create placeholder assistant message (will be updated via streaming)
  const assistantMessage: Message = {
    id: assistantMessageId,
    role: "assistant",
    content: "",
    isStreaming: true,
    toolCalls: [],
  };

  setMessages((prev) => [...prev, userMessage, assistantMessage]);
}
```

**What Happens**:
1. ✅ User message added to chat
2. ✅ Empty assistant message created (will be filled via streaming)
3. ✅ UI shows "streaming" state

---

### Step 2: Frontend Sends Streaming Request

**Location**: `ai-sidebar.tsx` (continued)

```typescript
// Use fetch API for SSE streaming
const response = await fetch("/api/external-service/ai/chat/stream", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  credentials: "include",
  body: JSON.stringify({
    messages: apiMessages,  // Conversation history
    ...(pageId && { pageId }),  // Current document ID
  }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();
```

**What Happens**:
1. ✅ HTTP POST to NestJS backend
2. ✅ Includes entire conversation history
3. ✅ Includes current page ID for context
4. ✅ Returns ReadableStream (SSE)

---

### Step 3: NestJS Backend Proxies to Python AI Service

**Location**: `apps/server/src/integrations/external-service/external-service.controller.ts`

```typescript
@Post('ai/chat/stream')
async aiChatStream(
  @Body() dto: AiChatRequestDto,
  @AuthUser() user: User,
  @AuthWorkspace() workspace: Workspace,
  @Res() res: Response,
): Promise<void> {
  // 1. Check permissions
  const ability = this.workspaceAbility.createForUser(user, workspace);
  if (ability.cannot(WorkspaceCaslAction.Edit, WorkspaceCaslSubject.Settings)) {
    throw new ForbiddenException('Insufficient permissions');
  }

  // 2. Rate limiting (30 requests per minute)
  await this.rateLimiterService.checkRateLimit(user.id, workspace.id, 30, 60000);

  // 3. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // 4. Stream from Python service to frontend
  for await (const chunk of this.aiChatService.streamChatMessage(dto, workspace, user.id)) {
    res.write(chunk);
  }
  res.end();
}
```

**What Happens**:
1. ✅ Validates user permissions
2. ✅ Checks rate limits
3. ✅ Sets SSE headers
4. ✅ Forwards stream from Python → Frontend

---

**Location**: `apps/server/src/integrations/external-service/ai-chat.service.ts`

```typescript
async* streamChatMessage(
  request: AiChatRequestDto,
  workspace: Workspace,
  userId: string,
): AsyncGenerator<string, void, unknown> {
  const url = `${this.baseUrl}/api/chat/stream`;  // Python AI service

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-Workspace-Id': workspace.id,
      'X-User-Id': userId,
      ...(request.pageId && { 'X-Page-Id': request.pageId }),
    },
    body: JSON.stringify({ messages: request.messages }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    yield chunk;  // Forward to frontend
  }
}
```

**What Happens**:
1. ✅ Calls Python AI service at `http://localhost:8000/api/chat/stream`
2. ✅ Adds authentication headers
3. ✅ Streams response chunks back to frontend

---

### Step 4: Python AI Service Processes Request

**Location**: `ai/main.py`

```python
@app.post("/api/chat/stream", dependencies=[Depends(verify_api_key)])
async def chat_stream(
    request: ChatRequest,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_page_id: Optional[str] = Header(None)
):
    """Stream chat responses with tool execution visibility"""
    
    # 1. Get the agent
    agent = get_document_agent()
    
    # 2. Create SSE event generator
    async def event_generator():
        try:
            # 3. Stream from LangGraph agent
            async for event in agent.run_stream(
                query=request.messages[-1].content,
                workspace_id=workspace_id,
                user_id=user_id,
                page_id=page_id,
                message_history=message_history,
            ):
                # 4. Format as SSE and yield
                event_type = event.get("type", "message")
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event)}\n\n"
                
        except Exception as e:
            # Error event
            yield f"event: error\n"
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Done event
            yield f"event: done\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
```

**What Happens**:
1. ✅ Extracts workspace/user/page context from headers
2. ✅ Calls LangGraph agent's `run_stream` method
3. ✅ Formats events as SSE: `event: type\ndata: {...}\n\n`
4. ✅ Streams events back to NestJS

---

### Step 5: LangGraph Agent Processes Query

**Location**: `ai/agents/document_agent.py`

```python
async def run_stream(
    self,
    query: str,
    workspace_id: str,
    user_id: str,
    page_id: Optional[str] = None,
    message_history: Optional[List[Dict[str, str]]] = None,
):
    """Stream agent execution with real-time event updates"""
    
    # 1. Build initial state
    messages = []
    if message_history:
        for msg in message_history:
            messages.append(HumanMessage(content=msg["content"]) if msg["role"] == "user" 
                          else AIMessage(content=msg["content"]))
    messages.append(HumanMessage(content=query))
    
    initial_state = {
        "messages": messages,
        "pending_tool_calls": [],
        "context": {
            "workspaceId": workspace_id,
            "userId": user_id,
            "pageId": page_id,
        }
    }
    
    # 2. Stream from LangGraph
    async for chunk in self._agent.astream(initial_state, stream_mode="updates"):
        for node_name, node_output in chunk.items():
            if node_name == "llm_call":
                # LLM response
                last_message = node_output["messages"][-1]
                
                # Yield tool calls
                if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                    yield {
                        "type": "tool_calls",
                        "tool_calls": [{"name": tc.name, "args": tc.args} 
                                      for tc in last_message.tool_calls]
                    }
                
                # Yield text content
                if last_message.content:
                    content_text = extract_text_from_gemini_format(last_message.content)
                    yield {
                        "type": "message",
                        "content": content_text
                    }
            
            elif node_name == "tools":
                # Tool execution results
                for msg in node_output["messages"]:
                    if isinstance(msg, ToolMessage):
                        yield {
                            "type": "tool_result",
                            "tool_name": msg.name,
                            "content": msg.content,
                        }
                
                # Frontend tools (write operations)
                if node_output.get("pending_tool_calls"):
                    yield {
                        "type": "pending_tools",
                        "tools": node_output["pending_tool_calls"]
                    }
```

**Event Types Yielded**:

| Event Type | Description | Example |
|------------|-------------|---------|
| `message` | LLM text response | `{"type": "message", "content": "I'll update that for you..."}` |
| `tool_calls` | Tools LLM decided to use | `{"type": "tool_calls", "tool_calls": [{"name": "vector_search", "args": {...}}]}` |
| `tool_result` | Result of tool execution | `{"type": "tool_result", "tool_name": "vector_search", "content": "Found 10 results..."}` |
| `pending_tools` | Frontend tools to execute | `{"type": "pending_tools", "tools": [{"tool": "find_and_replace", "params": {...}}]}` |
| `error` | Error occurred | `{"type": "error", "error": "Connection timeout"}` |
| `done` | Stream complete | `{"type": "done", "done": true}` |

**What Happens**:
1. ✅ LangGraph agent iterates through nodes (llm_call → tools → llm_call → end)
2. ✅ Each iteration yields events in real-time
3. ✅ **Read tools** (vector_search, get_document) execute in Python
4. ✅ **Write tools** (insert_content, find_and_replace) sent to frontend as `pending_tools`

---

### Step 6: Frontend Receives & Parses SSE Events

**Location**: `ai-sidebar.tsx` (continued)

```typescript
let buffer = "";
let currentEventType = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse "event: type"
    if (line.startsWith("event: ")) {
      currentEventType = line.slice(7).trim();
      continue;
    }

    // Parse "data: {...}"
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      const event = JSON.parse(data);
      const eventType = event.type || currentEventType;

      // Update assistant message based on event type
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;

          switch (eventType) {
            case "message":
              return {
                ...msg,
                content: (msg.content || "") + (event.content || ""),
              };

            case "tool_calls":
              const newToolCalls = event.tool_calls.map((tc: any) => ({
                name: tc.name,
                status: "executing" as const,
              }));
              return {
                ...msg,
                toolCalls: [...(msg.toolCalls || []), ...newToolCalls],
              };

            case "tool_result":
              return {
                ...msg,
                toolCalls: (msg.toolCalls || []).map((tc) =>
                  tc.name === event.tool_name
                    ? { ...tc, status: "completed" as const, result: event.content }
                    : tc
                ),
              };

            case "pending_tools":
              // Execute tools in the editor
              event.tools.forEach((tool: AiToolCall) => {
                toolExecutor.execute(tool);
              });
              return msg;

            case "done":
              return { ...msg, isStreaming: false };

            case "error":
              return {
                ...msg,
                content: `Error: ${event.error}`,
                isStreaming: false,
              };

            default:
              return msg;
          }
        })
      );
    }
  }
}
```

**What Happens**:
1. ✅ Parses SSE format line by line
2. ✅ Updates assistant message in real-time
3. ✅ `message` events → append text to chat
4. ✅ `tool_calls` events → show tool execution badges
5. ✅ `tool_result` events → update tool status
6. ✅ `pending_tools` events → execute in editor via `toolExecutor`

---

### Step 7: Tool Execution in Frontend

**Location**: `apps/client/src/features/ai/services/tool-executor.ts`

```typescript
export class ToolExecutor {
  private editor: Editor;
  private previewMode: boolean = false;
  private pendingChanges: Array<{ id: string; toolCall: AiToolCall; applied: boolean }> = [];

  /**
   * Execute a tool call (or queue for preview)
   */
  execute(toolCall: AiToolCall): boolean {
    if (this.previewMode) {
      // Preview mode: Queue change for user approval
      const changeId = `change-${Date.now()}-${Math.random()}`;
      this.pendingChanges.push({ id: changeId, toolCall, applied: false });
      
      // Notify listeners (AiChangeTracker)
      this.changeProposedListeners.forEach((listener) => {
        listener({
          id: changeId,
          type: this.getChangeType(toolCall),
          description: this.getChangeDescription(toolCall),
          toolCall: toolCall,
        });
      });
      
      return true;
    } else {
      // Direct mode: Execute immediately
      return this.executeInternal(toolCall);
    }
  }

  /**
   * Internal execution (actual Tiptap commands)
   */
  private executeInternal(toolCall: AiToolCall): boolean {
    switch (toolCall.tool) {
      case 'insert_content':
        return this.insertContent(toolCall.params);
      case 'replace_content':
        return this.replaceContent(toolCall.params);
      case 'delete_content':
        return this.deleteContent(toolCall.params);
      case 'find_and_replace':
        return this.findAndReplace(toolCall.params);
      case 'format_text':
        return this.formatText(toolCall.params);
      case 'insert_block':
        return this.insertBlock(toolCall.params);
      case 'apply_formatting':
        return this.applyFormatting(toolCall.params);
      case 'clear_formatting':
        return this.clearFormatting(toolCall.params);
      default:
        console.warn('[ToolExecutor] Unknown tool:', toolCall);
        return false;
    }
  }
}
```

**What Happens**:

#### Preview Mode OFF (Default):
1. ✅ Tool executes **immediately** in editor
2. ✅ Changes visible **instantly**
3. ✅ No user confirmation needed

#### Preview Mode ON:
1. ✅ Tool **queued** as pending change
2. ✅ `AiChangeTracker` UI shows proposed change
3. ✅ User can **Accept** or **Reject**

---

## Tool Execution System

### Tool Types & How They Work

#### 1. Insert Content

```typescript
private insertContent(params: InsertContentParams): boolean {
  const { content, position } = params;

  switch (position) {
    case 'start':
      // Insert at document start
      this.editor.commands.setTextSelection(0);
      this.editor.commands.insertContent(content);
      break;

    case 'end':
      // Insert at document end
      const docSize = this.editor.state.doc.content.size;
      this.editor.commands.setTextSelection(docSize);
      this.editor.commands.insertContent(content);
      break;

    case 'cursor':
    case 'after_selection':
      // Insert at current cursor/selection
      this.editor.commands.insertContent(content);
      break;
  }

  return true;
}
```

**Formatting Preservation**:
- ✅ Tiptap's `insertContent` automatically parses markdown
- ✅ Preserves existing formatting around insertion point
- ✅ Merges with adjacent text nodes correctly

---

#### 2. Replace Content

```typescript
private replaceContent(params: ReplaceContentParams): boolean {
  const { target, content } = params;

  if (target === 'all') {
    // Replace entire document
    this.editor.commands.clearContent();
    this.editor.commands.insertContent(content);
  } else {
    // Replace selection
    const { from, to } = this.editor.state.selection;
    this.editor.chain()
      .setTextSelection({ from, to })
      .deleteSelection()
      .insertContent(content)
      .run();
  }

  return true;
}
```

**Formatting Preservation**:
- ✅ Clears old content first
- ✅ Inserts new content with markdown parsing
- ✅ Maintains document structure

---

#### 3. Find and Replace

```typescript
private findAndReplace(params: FindAndReplaceParams): boolean {
  const { searchText, replaceText, replaceAll, caseSensitive, wholeWord } = params;

  // Build regex
  const flags = caseSensitive ? 'g' : 'gi';
  const pattern = wholeWord ? `\\b${searchText}\\b` : searchText;
  const regex = new RegExp(pattern, flags);

  const { doc } = this.editor.state;
  const tr = this.editor.state.tr;
  let modified = false;

  // Traverse document
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const text = node.text;
      const matches = Array.from(text.matchAll(regex));

      if (matches.length > 0) {
        const match = matches[0];
        const from = pos + match.index!;
        const to = from + match[0].length;

        // Replace text
        tr.replaceWith(from, to, this.editor.schema.text(replaceText));
        modified = true;

        // Stop if not replaceAll
        if (!replaceAll) {
          return false;
        }
      }
    }
  });

  if (modified) {
    this.editor.view.dispatch(tr);
  }

  return modified;
}
```

**Formatting Preservation**:
- ✅ Uses Tiptap transactions for atomic updates
- ✅ Preserves marks (bold, italic, etc.) on replaced text
- ✅ Maintains node structure around replacements

---

#### 4. Format Text

```typescript
private formatText(params: FormatTextParams): boolean {
  const { format, target } = params;

  if (target === 'selection') {
    // Format selected text
    const { from, to } = this.editor.state.selection;
    
    switch (format) {
      case 'bold':
        this.editor.chain().setTextSelection({ from, to }).toggleBold().run();
        break;
      case 'italic':
        this.editor.chain().setTextSelection({ from, to }).toggleItalic().run();
        break;
      case 'code':
        this.editor.chain().setTextSelection({ from, to }).toggleCode().run();
        break;
      case 'strikethrough':
        this.editor.chain().setTextSelection({ from, to }).toggleStrike().run();
        break;
      // ... more formats
    }
  }

  return true;
}
```

**Formatting Preservation**:
- ✅ Uses Tiptap's toggle commands
- ✅ Preserves other marks when adding new ones
- ✅ Properly removes conflicting formats

---

## Change Preview & Acceptance

### Preview Mode Flow

```
User toggles "Preview Mode" ON
         ↓
AI suggests change
         ↓
Tool queued (not executed)
         ↓
AiChangeTracker shows proposed change
         ↓
User clicks "Accept" → toolExecutor.applyChange(changeId)
         ↓
Change applied to editor
         ↓
Change removed from pending list
```

### AiChangeTracker Component

**Location**: `apps/client/src/features/ai/components/ai-change-tracker.tsx`

```typescript
export const AiChangeTracker: FC<AiChangeTrackerProps> = ({
  editor,
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
}) => {
  return (
    <div className={styles.changeTracker}>
      <div className={styles.header}>
        <h3>Proposed Changes</h3>
        <div className={styles.actions}>
          <button onClick={onAcceptAll}>Accept All</button>
          <button onClick={onRejectAll}>Reject All</button>
        </div>
      </div>

      <div className={styles.changeList}>
        {changes.map((change) => (
          <div key={change.id} className={styles.changeItem}>
            <div className={styles.changeType}>{change.type}</div>
            <div className={styles.changeDescription}>{change.description}</div>
            <div className={styles.changeActions}>
              <button onClick={() => onAccept(change.id)}>Accept</button>
              <button onClick={() => onReject(change.id)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

**What It Shows**:
- ✅ List of all pending changes
- ✅ Change type (insert/replace/delete/format)
- ✅ Human-readable description
- ✅ Accept/Reject buttons per change
- ✅ Accept All/Reject All bulk actions

---

## Formatting & Editor Integration

### Tiptap Editor Commands

Tiptap provides a **transaction-based** editing system that **preserves formatting automatically**:

```typescript
// Example: Replace text while preserving marks
const { from, to } = this.editor.state.selection;

// Get existing marks at selection
const marks = this.editor.state.doc.resolve(from).marks();

// Create new text node with same marks
const newText = this.editor.schema.text("new text", marks);

// Replace via transaction
const tr = this.editor.state.tr;
tr.replaceWith(from, to, newText);
this.editor.view.dispatch(tr);
```

### How Formatting Is Preserved

1. **Marks** (bold, italic, links, etc.) are **attributes** on text nodes
2. When inserting content, Tiptap:
   - Parses markdown → ProseMirror nodes
   - Merges marks from surrounding text
   - Maintains mark consistency
3. When replacing content:
   - Extracts marks from selection
   - Applies to new content
   - Merges with adjacent nodes

### Markdown Parsing

```typescript
// AI sends: "**bold text** and *italic*"
this.editor.commands.insertContent("**bold text** and *italic*");

// Tiptap automatically converts to:
// <p><strong>bold text</strong> and <em>italic</em></p>
```

---

## Real-time Updates with Yjs

### Yjs Integration

**Location**: `apps/client/src/features/editor/components/editor.tsx`

```typescript
const provider = new HocuspocusProvider({
  url: websocketUrl,
  name: `page.${pageId}`,
  document: ydoc,
  token: accessToken,
});

const editor = useEditor({
  extensions: [
    // Yjs collaboration extension
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider: provider,
      user: {
        name: userName,
        color: userColor,
      },
    }),
    // ... other extensions
  ],
});
```

### How AI Changes Sync

```
AI tool executes
      ↓
Tiptap transaction applied
      ↓
Yjs detects change
      ↓
Yjs encodes change as Y.Doc update
      ↓
HocuspocusProvider sends to server
      ↓
Server broadcasts to all connected clients
      ↓
Other clients apply update
      ↓
All users see change in real-time
```

**Key Points**:
- ✅ AI changes treated like **any other edit**
- ✅ No special handling needed
- ✅ Other users see changes **immediately**
- ✅ Conflict resolution handled by Yjs automatically

---

## Troubleshooting

### Issue 1: Changes Not Visible

**Symptoms**: AI says "I updated X" but nothing changes

**Diagnosis**:
1. Check browser console for errors
2. Check if frontend is calling streaming endpoint:
   ```
   [AiSidebar] Starting streaming request...
   ```
3. Check NestJS logs:
   ```
   [ExternalServiceController] User ... using AI chat stream  ← Should say "stream"!
   ```
4. Check Python logs:
   ```
   [AGENT TOOLS] Write operation: find_and_replace -> queuing for frontend
   [DocumentAgent] Pending tool calls: 1
   ```

**Common Causes**:
- ❌ Browser cache (hard refresh: Ctrl+Shift+R)
- ❌ Old frontend JS bundle loaded
- ❌ Preview mode ON (changes queued, not applied)
- ❌ Tool executor not initialized

**Fix**:
```bash
# Hard refresh browser
Ctrl + Shift + R (Windows)
Cmd + Shift + R (Mac)

# Or disable cache in DevTools
F12 → Network tab → Check "Disable cache"
```

---

### Issue 2: Tool Calls Not Showing

**Symptoms**: Sidebar just shows "Thinking..." without tool details

**Diagnosis**:
1. Check if `tool_calls` events are being received:
   ```typescript
   console.log("[AiSidebar] Received event:", event.type, event);
   ```
2. Check Python logs for tool execution:
   ```
   [AGENT TOOLS] Executing: vector_search
   [AGENT TOOLS] Tool execution result success: True
   ```

**Common Causes**:
- ❌ Using old `/api/chat` endpoint (non-streaming)
- ❌ SSE parsing broken
- ❌ Message state not updating correctly

**Fix**:
- Ensure `/api/chat/stream` is being called
- Check SSE event parsing in `ai-sidebar.tsx`
- Verify `setMessages` updates `toolCalls` array

---

### Issue 3: Formatting Lost on Replace

**Symptoms**: Replacing text removes bold/italic/links

**Diagnosis**:
```typescript
// Check if marks are preserved
const marks = this.editor.state.doc.resolve(from).marks();
console.log("Marks at selection:", marks);
```

**Common Causes**:
- ❌ Using `setContent` instead of `insertContent`
- ❌ Not extracting marks before replace
- ❌ Markdown parsing disabled

**Fix**:
```typescript
// BAD: Loses marks
this.editor.commands.setContent(newText);

// GOOD: Preserves marks
this.editor.commands.deleteSelection();
this.editor.commands.insertContent(newText);
```

---

### Issue 4: Streaming Timeout

**Symptoms**: Connection closes after 30 seconds

**Diagnosis**:
```
[AiChatService] Stream timeout after 30000ms
```

**Common Causes**:
- ❌ Long-running tool (vector search takes >30s)
- ❌ Python service slow
- ❌ Network timeout

**Fix**:
```typescript
// Increase timeout in ai-chat.service.ts
const timeoutMs = 60000;  // 60 seconds instead of 30
```

---

### Issue 5: Preview Mode Not Working

**Symptoms**: Changes apply immediately even with preview mode ON

**Diagnosis**:
```typescript
console.log("[ToolExecutor] Preview mode:", this.previewMode);
console.log("[ToolExecutor] Pending changes:", this.pendingChanges.length);
```

**Common Causes**:
- ❌ Preview mode not set on tool executor
- ❌ Change listeners not registered
- ❌ `AiChangeTracker` not rendered

**Fix**:
```typescript
// In ai-sidebar.tsx
const toolExecutor = useMemo(() => {
  const executor = new ToolExecutor(editor);
  executor.setPreviewMode(previewMode);  // Set preview mode
  executor.onChangeProposed((change) => {  // Register listener
    setProposedChanges((prev) => [...prev, change]);
  });
  return executor;
}, [editor, previewMode]);
```

---

## Summary: Complete Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. User types message in AI Sidebar                              │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. Frontend: fetch("/api/external-service/ai/chat/stream")       │
│    - Sends conversation history                                  │
│    - Includes page ID                                            │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. NestJS: Validates, sets SSE headers, proxies to Python       │
│    - Checks permissions & rate limits                            │
│    - Forwards stream                                             │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. Python: LangGraph agent processes query                       │
│    - Calls Gemini 2.5 Flash LLM                                  │
│    - Executes tools (vector_search, get_document)               │
│    - Yields events: message, tool_calls, tool_result            │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. Events stream back: Python → NestJS → Frontend               │
│    - SSE format: "event: type\ndata: {...}\n\n"                 │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. Frontend parses SSE events                                    │
│    - "message" → Append text to chat                            │
│    - "tool_calls" → Show tool badges                            │
│    - "tool_result" → Update tool status                         │
│    - "pending_tools" → Execute in editor                        │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 7. ToolExecutor executes changes                                 │
│    - Preview OFF: Execute immediately                            │
│    - Preview ON: Queue for approval                             │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 8. Tiptap applies changes                                        │
│    - Parses markdown                                             │
│    - Preserves formatting                                        │
│    - Creates transaction                                         │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 9. Yjs syncs to all clients                                      │
│    - Encodes change                                              │
│    - Broadcasts via WebSocket                                    │
│    - All users see update in real-time                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Streaming is key**: SSE enables real-time updates without polling
2. **Three-layer architecture**: Frontend → NestJS → Python (clean separation)
3. **Tool execution split**: Read tools (Python) vs Write tools (Frontend)
4. **Tiptap handles formatting**: Transaction-based system preserves marks automatically
5. **Yjs handles sync**: AI changes sync just like manual edits
6. **Preview mode optional**: Users can review changes before applying
7. **Event-driven**: Everything is async, non-blocking, real-time

---

## Files Reference

### Frontend
- `apps/client/src/features/editor/components/ai-sidebar/ai-sidebar.tsx` - Main UI
- `apps/client/src/features/ai/services/tool-executor.ts` - Tool execution
- `apps/client/src/features/ai/components/ai-change-tracker.tsx` - Change preview
- `apps/client/src/features/ai/types/ai-tools.types.ts` - Tool type definitions

### Backend (NestJS)
- `apps/server/src/integrations/external-service/external-service.controller.ts` - API endpoint
- `apps/server/src/integrations/external-service/ai-chat.service.ts` - Streaming proxy

### AI Service (Python)
- `ai/main.py` - FastAPI endpoints
- `ai/agents/document_agent.py` - LangGraph agent
- `ai/tools/` - Tool implementations

---

**For more info, see**:
- `AI_STREAMING_IMPLEMENTATION.md` - Technical streaming details
- `AI_QUICK_START.md` - Quick reference guide
- `GEMINI_2.5_FIX.md` - Gemini 2.5 compatibility fix
