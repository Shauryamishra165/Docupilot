# AI Agent Capabilities & Stress Testing Guide

## Current Agent Capabilities

### 📖 **Reading Operations**
| Query Type | Example | Tool Used |
|------------|---------|-----------|
| Read document | "What's in this document?" | `read_document` |
| Get structure | "Show me the headings" | `get_page_structure` |
| Search content | "Find mentions of revenue" | `vector_search` |
| List pages | "What pages exist?" | `list_workspace_pages` |
| Get metadata | "When was this page created?" | `get_page_metadata` |

### ✏️ **Editing Operations**
| Query Type | Example | Tool Used |
|------------|---------|-----------|
| Find & Replace | "Change www.old.com to www.new.com" | `find_and_replace` |
| Replace All | "Change all instances of X to Y" | `find_and_replace` (replaceAll=true) |
| Insert Content | "Add a paragraph about..." | `insert_content` |
| Replace Document | "Rewrite this entire document" | `replace_document` |
| Format Text | "Make the title bold" | `apply_formatting` |
| Clear Formatting | "Remove all bold from text" | `clear_formatting` |

### 🔍 **Semantic Operations**
| Query Type | Example | Tool Used |
|------------|---------|-----------|
| Semantic Search | "Find content about financial reports" | `vector_search` |
| Cross-document | "What pages mention this company?" | `vector_search` |

---

## 🧪 **Stress Test Scenarios**

### Test 1: Simple Text Replacement
```
Query: "Change all instances of 'Company A' to 'Company B'"
Expected: All occurrences replaced, highlighted with accept/reject
```

### Test 2: URL Replacement
```
Query: "Replace www.oldsite.com with www.newsite.com everywhere"
Expected: All URLs replaced throughout document
```

### Test 3: Numeric Change
```
Query: "Change 8,500 shares to 100,000 shares"
Expected: Number updated where found
```

### Test 4: Heading Change
```
Query: "Change the main title to 'New Document Title'"
Expected: H1 heading updated
```

### Test 5: Content Generation
```
Query: "Add a section about company history after the introduction"
Expected: New content inserted at appropriate location
```

### Test 6: Multi-document Search
```
Query: "Find all pages that mention 'quarterly report'"
Expected: List of matching pages with context
```

### Test 7: Document Rewrite
```
Query: "Summarize this document in 3 paragraphs"
Expected: New summarized content (use with caution)
```

### Test 8: Formatting
```
Query: "Make all headings bold"
Expected: Formatting applied to headings
```

---

## 🚀 **What to Add for Complete AI Editor**

### Priority 1: Core Features ✅ IMPLEMENTED
- [x] **Semantic insertion** - `insert_after_section` tool for contextual insertion
- [x] **Multi-occurrence highlighting** - All changes tracked with individual accept/reject
- [x] **Undo stack integration** - Reject = undo the change
- [x] **Markdown-to-Tiptap conversion** - Automatic HTML conversion

### Priority 2: Advanced Features ✅ IMPLEMENTED
- [x] **Table editing** - `table_edit` tool: create_table, add_row, delete_row, add_column, delete_column, update_cell
- [ ] **Image handling** - Insert images from URLs or generate with AI
- [ ] **Code block formatting** - Proper syntax highlighting
- [ ] **Link management** - Add, update, remove links
- [ ] **Comment integration** - AI can add comments to document

### Priority 3: Intelligence
- [ ] **Context-aware suggestions** - Suggest edits based on document type
- [ ] **Grammar/spelling** - Fix grammar and spelling errors
- [ ] **Tone adjustment** - Rewrite in different tones (formal, casual)
- [ ] **Translation** - Translate document content
- [ ] **Summarization** - Generate summaries and TL;DRs

### Priority 4: Collaboration
- [ ] **AI cursor** - Show AI's "cursor" when editing
- [ ] **Change attribution** - Mark changes as "AI-generated"
- [ ] **Approval workflow** - Queue changes for review

---

## 📋 **Known Limitations**

1. **Markdown Output**: Agent may return markdown which appears raw. Solution: Use markdown transformer.

2. **Position Finding**: Agent may struggle with semantic positioning ("after the introduction"). Solution: Add `get_section_position` tool.

3. **Complex Formatting**: Nested lists, tables may not preserve perfectly. Solution: Use JSON content format.

4. **Multi-step Changes**: Complex edits may need multiple tool calls. Solution: Chain tools automatically.

---

## 🔧 **Debugging Tips**

### Check Python Agent Logs
```bash
cd ai
python main.py
# Watch for [AGENT LLM] and [AGENT TOOLS] logs
```

### Check if Tools are Called
Look for:
```
[AGENT LLM] Tool calls found: 1
[AGENT LLM]   - Tool: find_and_replace
```

### Check if Changes Applied
Look in backend logs for:
```
[AiChatService] AI chat stream completed
Page updated: ...
```

### Browser Console
Open DevTools (F12) and look for:
```
[AiSidebar] Executing tool: find_and_replace
[ToolExecutor] Applied tracked change
```

---

## 📊 **Performance Metrics**

| Metric | Target | Current |
|--------|--------|---------|
| Response time | < 5s | ~3-5s |
| Streaming latency | < 500ms | ~200ms |
| Tool execution | < 1s | ~100ms |
| Multi-replace | < 3s | ~1s |

---

## 🎯 **Recommended Testing Flow**

1. **Start with read**: "What's in this document?"
2. **Simple change**: "Change X to Y"
3. **Bulk change**: "Change all X to Y everywhere"
4. **Content add**: "Add a paragraph about Z"
5. **Structure change**: "Change the heading to W"
6. **Cross-document**: "Find pages about topic T"

This progression tests increasingly complex features.
