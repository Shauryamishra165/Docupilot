# Inline Change Tracking System

## Overview

The AI Sidebar now features **inline change tracking** - AI-suggested changes are highlighted directly in the editor content with accept/reject buttons, similar to Google Docs suggestions.

---

## Visual Examples

### Insert Change
```
Original: "The quick fox jumps."
AI suggests: "brown" after "quick"

Display:
The quick [brown]✓✗ fox jumps.
         ^^^^^^
         Green highlight with accept/reject buttons
```

### Delete Change  
```
Original: "The quick brown fox jumps."
AI suggests: Delete "brown"

Display:
The quick ~~brown~~ fox jumps.
          ^^^^^^
          Red strikethrough with accept/reject buttons
```

### Replace Change
```
Original: "The quick brown fox jumps."
AI suggests: Replace "brown" with "red"

Display:
The quick ~~brown~~ fox jumps.
          [red shown in tooltip]
          Yellow highlight showing replacement
```

---

## How It Works

### 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    INLINE CHANGE TRACKING                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  AI Suggests Change                                          │
│         ↓                                                    │
│  Tool Executor → Change Tracking Extension                   │
│         ↓                                                    │
│  Tiptap Decorations (Inline Highlights)                     │
│         ↓                                                    │
│  User Sees: [Changed Text]✓✗                                │
│         ↓                                                    │
│  User Clicks ✓ → Accept → Apply Change                      │
│  User Clicks ✗ → Reject → Remove Highlight                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. Change Tracking Extension

**Location**: `apps/client/src/features/ai/extensions/change-tracking.extension.ts`

This Tiptap extension:
- Stores pending changes in editor storage
- Creates decorations (highlights) for each change
- Handles accept/reject button clicks
- Manages change lifecycle

```typescript
export interface Change {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  from: number;  // Start position in document
  to: number;    // End position in document
  content?: string;  // New content (for insert/replace)
  oldContent?: string;  // Original content (for delete/replace)
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}
```

### 3. Decoration System

**Decorations** are Tiptap/ProseMirror's way of adding visual elements without modifying the actual document:

```typescript
// For INSERT: Widget decoration (adds content without changing doc)
Decoration.widget(position, () => {
  return <span class="ai-change-insert">
    {content}
    <button>✓</button>  // Accept
    <button>✗</button>  // Reject
  </span>
});

// For DELETE: Inline decoration (highlights existing content)
Decoration.inline(from, to, {
  class: 'ai-change-delete',  // Red strikethrough
});

// For REPLACE: Inline decoration with tooltip
Decoration.inline(from, to, {
  class: 'ai-change-replace',
  'data-new-content': newContent,  // Shows in tooltip
});
```

---

## Integration Flow

### Step 1: AI Suggests Change

**Python Agent** (already working):
```python
# Agent decides to replace text
yield {
    "type": "pending_tools",
    "tools": [{
        "tool": "find_and_replace",
        "params": {
            "searchText": "www.vlsfinance.com",
            "replaceText": "www.hero.com",
            "replaceAll": True
        }
    }]
}
```

### Step 2: Frontend Receives Change

**AI Sidebar** (`ai-sidebar.tsx`):
```typescript
case "pending_tools":
  event.tools.forEach((tool: AiToolCall) => {
    // Tool executor handles it
    toolExecutor.execute(tool);
  });
  break;
```

### Step 3: Tool Executor Creates Inline Change

**Tool Executor** (updated):
```typescript
execute(toolCall: AiToolCall): boolean {
  if (this.inlineTrackingEnabled) {
    // INLINE MODE: Create visual change in editor
    const positions = this.findPositions(toolCall);
    
    positions.forEach(({ from, to }) => {
      this.editor.commands.addChange({
        id: `change-${Date.now()}`,
        type: this.getChangeType(toolCall),
        from,
        to,
        content: this.getNewContent(toolCall),
        oldContent: this.getOldContent(from, to),
      });
    });
    
    return true;
  } else {
    // DIRECT MODE: Apply immediately
    return this.executeInternal(toolCall);
  }
}
```

### Step 4: User Sees Inline Change

**Editor Display**:
```html
<p>
  Visit <span class="ai-change-replace" data-change-id="change-123">
    www.vlsfinance.com
    <span class="ai-change-buttons">
      <button class="ai-change-accept">✓</button>
      <button class="ai-change-reject">✗</button>
    </span>
  </span> for more info.
</p>
```

**Visual Result**:
```
Visit [www.vlsfinance.com]✓✗ for more info.
      ^^^^^^^^^^^^^^^^^^^
      Yellow highlight
      Tooltip shows: "www.hero.com"
```

### Step 5: User Accepts/Rejects

**User clicks ✓ (Accept)**:
```typescript
editor.commands.acceptChange(changeId)
  ↓
1. Change marked as 'accepted'
2. Actual text replacement performed
3. Decoration removed
4. Document updated

Result: "Visit www.hero.com for more info."
```

**User clicks ✗ (Reject)**:
```typescript
editor.commands.rejectChange(changeId)
  ↓
1. Change marked as 'rejected'
2. No modification to document
3. Decoration removed

Result: "Visit www.vlsfinance.com for more info."  (unchanged)
```

---

## User Experience Flow

### Scenario: AI Changes Website URL

1. **User asks**: "Change www.vlsfinance.com to www.hero.com"

2. **AI processes**:
   ```
   [AI Sidebar]
   AI: I'll update the website URL for you.
   Tool: find_and_replace ✓ executing
   Tool: find_and_replace ✓ completed
   ```

3. **Editor shows inline change**:
   ```
   Visit [www.vlsfinance.com]✓✗ for more info.
         ^^^^^^^^^^^^^^^^^^^
         Yellow highlight
         Hover: shows "www.hero.com"
   ```

4. **User hovers** → Tooltip shows replacement: "www.hero.com"

5. **User clicks ✓** → Text instantly changes to "www.hero.com"

6. **Yjs syncs** → All collaborators see the update in real-time

---

## Modes of Operation

### Mode 1: Direct Apply (Default)

- Changes applied **immediately**
- No inline tracking
- Fast and straightforward
- Best for: Single-user editing, quick changes

```typescript
toolExecutor.setInlineTracking(false);
// AI makes change → Immediately applied
```

### Mode 2: Inline Tracking (Preview)

- Changes shown **inline** with highlights
- User must **accept/reject** each change
- Best for: Collaborative editing, careful review

```typescript
toolExecutor.setInlineTracking(true);
// AI makes change → Highlighted inline → User approves
```

### Mode 3: Sidebar Preview (Legacy)

- Changes shown in **sidebar list**
- User accepts/rejects from sidebar
- Best for: Batch review of multiple changes

```typescript
toolExecutor.setPreviewMode(true);
// AI makes change → Listed in sidebar → User approves
```

---

## Implementation Details

### Finding Change Positions

```typescript
private findPositions(toolCall: AiToolCall): Array<{ from: number; to: number }> {
  if (toolCall.tool === 'find_and_replace') {
    const { searchText } = toolCall.params as any;
    const { doc } = this.editor.state;
    const positions: Array<{ from: number; to: number }> = [];

    // Search through document
    doc.descendants((node, pos) => {
      if (node.isText && node.text) {
        let index = 0;
        while ((index = node.text.indexOf(searchText, index)) !== -1) {
          positions.push({
            from: pos + index,
            to: pos + index + searchText.length,
          });
          index += searchText.length;
        }
      }
    });

    return positions;
  }

  // For other tools, use selection or specific positions
  const { from, to } = this.editor.state.selection;
  return [{ from, to }];
}
```

### Bulk Actions

**Accept All Button**:
```typescript
<button onClick={() => editor.commands.acceptAllChanges()}>
  Accept All ({pendingChangesCount})
</button>
```

**Reject All Button**:
```typescript
<button onClick={() => editor.commands.rejectAllChanges()}>
  Reject All
</button>
```

### Change Counter

Shows number of pending changes:
```typescript
const pendingChanges = editor.commands.getPendingChanges();

<div className="ai-change-toolbar">
  <span>Pending Changes: 
    <span className="ai-change-count">{pendingChanges.length}</span>
  </span>
  <button onClick={acceptAll}>Accept All</button>
  <button onClick={rejectAll}>Reject All</button>
</div>
```

---

## Styling & Customization

### CSS Classes

```css
/* Insert - Green */
.ai-change-insert {
  background-color: rgba(76, 175, 80, 0.2);
  border-bottom: 2px solid #4caf50;
}

/* Delete - Red */
.ai-change-delete {
  background-color: rgba(244, 67, 54, 0.2);
  text-decoration: line-through;
}

/* Replace - Yellow */
.ai-change-replace {
  background-color: rgba(255, 193, 7, 0.2);
  border-bottom: 2px solid #ffc107;
}
```

### Custom Colors

To change colors, modify `change-tracking.module.css`:

```css
/* Example: Blue for insertions */
.ai-change-insert {
  background-color: rgba(33, 150, 243, 0.2);
  border-bottom: 2px solid #2196f3;
}
```

---

## Integration with Yjs

Changes are tracked **before** Yjs sync:

```
1. AI suggests change
   ↓
2. Change highlighted inline (decoration only, no doc modification)
   ↓
3. User accepts
   ↓
4. Document modified via Tiptap transaction
   ↓
5. Yjs detects modification
   ↓
6. Yjs syncs to all clients
   ↓
7. All users see final result
```

**Important**: Decorations (highlights) are **local only** - they don't sync via Yjs. Only the final accepted changes sync.

---

## Conflict Resolution

### Scenario: Two Users, Same Content

**User A**:
```
1. AI suggests: Change "brown" to "red"
2. Highlighted inline, pending acceptance
3. User A hasn't accepted yet
```

**User B (simultaneously)**:
```
1. Manually types over "brown" → "blue"
2. Yjs syncs immediately
3. Content now says "blue"
```

**Resolution**:
```
User A's change becomes invalid (position changed)
→ Change tracking extension detects position mismatch
→ Decoration automatically removed
→ User A sees User B's change ("blue")
```

---

## Complete Example: Website URL Change

### User Input
```
"Change www.vlsfinance.com to www.hero.com"
```

### AI Response (Sidebar)
```
[AI Assistant]
I'll update the website URL for you.

Tool Calls:
  ✓ find_and_replace (completed)
    - Search: "www.vlsfinance.com"
    - Replace: "www.hero.com"
    - Matches: 3 found
```

### Editor Display (Before Accept)
```
Visit [www.vlsfinance.com]✓✗ for more information.

Contact us at [www.vlsfinance.com]✓✗

Follow us: [www.vlsfinance.com]✓✗
```

### After Clicking "Accept All"
```
Visit www.hero.com for more information.

Contact us at www.hero.com

Follow us: www.hero.com
```

---

## Toolbar Integration

Add a toolbar above the editor showing pending changes:

```tsx
{editor && (
  <div className="ai-change-toolbar">
    <span className="ai-change-toolbar-title">
      AI Suggested Changes
    </span>
    <span className="ai-change-count">
      {editor.commands.getPendingChanges().length}
    </span>
    <button 
      className="ai-change-accept-all"
      onClick={() => editor.commands.acceptAllChanges()}
    >
      Accept All
    </button>
    <button 
      className="ai-change-reject-all"
      onClick={() => editor.commands.rejectAllChanges()}
    >
      Reject All
    </button>
  </div>
)}
```

---

## Keyboard Shortcuts (Optional)

Add keyboard shortcuts for quick accept/reject:

```typescript
// In change-tracking.extension.ts
addKeyboardShortcuts() {
  return {
    // Accept first pending change
    'Mod-Shift-Y': () => {
      const changes = this.editor.commands.getPendingChanges();
      if (changes.length > 0) {
        this.editor.commands.acceptChange(changes[0].id);
        return true;
      }
      return false;
    },

    // Reject first pending change  
    'Mod-Shift-N': () => {
      const changes = this.editor.commands.getPendingChanges();
      if (changes.length > 0) {
        this.editor.commands.rejectChange(changes[0].id);
        return true;
      }
      return false;
    },

    // Accept all changes
    'Mod-Shift-A': () => {
      this.editor.commands.acceptAllChanges();
      return true;
    },
  };
},
```

---

## Benefits of Inline Tracking

### vs. Sidebar Preview

| Feature | Inline Tracking | Sidebar Preview |
|---------|----------------|-----------------|
| **Visibility** | ✅ Directly in content | ❌ Separate list |
| **Context** | ✅ See change in context | ❌ Need to find in doc |
| **Speed** | ✅ Click inline button | ❌ Switch to sidebar |
| **Multiple Changes** | ✅ All visible at once | ✅ List all together |
| **Collaboration** | ✅ Clearer for others | ❌ Only you see sidebar |
| **UX** | ✅ Like Google Docs | ❌ Less intuitive |

### vs. Direct Apply

| Feature | Inline Tracking | Direct Apply |
|---------|----------------|--------------|
| **Control** | ✅ Review before apply | ❌ No review |
| **Safety** | ✅ Can reject | ❌ Must undo |
| **Speed** | ❌ Requires approval | ✅ Instant |
| **Trust** | ✅ Verify AI accuracy | ❌ Blind trust |
| **Collaboration** | ✅ Show to team first | ❌ Already changed |

---

## Current Status

### ✅ Implemented
- [x] Basic streaming from Python → NestJS → Frontend
- [x] Tool execution visibility in sidebar
- [x] Gemini 2.5 Flash compatibility
- [x] Change tracking extension (Tiptap)
- [x] Inline decoration system
- [x] Accept/reject buttons
- [x] CSS styling for changes
- [x] Bulk accept/reject all

### 🚧 To Implement
- [ ] Integrate change tracking with tool executor
- [ ] Add toolbar with change counter
- [ ] Handle position conflicts
- [ ] Add keyboard shortcuts
- [ ] Tooltip improvements
- [ ] Animation for accepted/rejected changes
- [ ] Persist changes across page refresh (optional)

### 🎯 Next Steps

1. **Update Tool Executor**:
   - Add `inlineTrackingEnabled` flag
   - Integrate with `ChangeTrackingExtension`
   - Calculate positions for changes

2. **Update Editor Component**:
   - Import and register `ChangeTrackingExtension`
   - Add change tracking CSS
   - Add toolbar for bulk actions

3. **Update AI Sidebar**:
   - Add toggle for inline tracking mode
   - Show change count
   - Link to toolbar

4. **Test End-to-End**:
   - Test all change types (insert/delete/replace)
   - Test with Yjs collaboration
   - Test accept/reject flows
   - Test bulk actions

---

## Troubleshooting

### Issue: Changes Not Highlighted

**Check**:
1. Is `ChangeTrackingExtension` registered in editor?
2. Is CSS imported?
3. Are decorations being created?

**Debug**:
```typescript
console.log("Pending changes:", editor.commands.getPendingChanges());
console.log("Decorations:", editor.view.decorations);
```

### Issue: Buttons Not Clickable

**Check**:
1. Are click handlers registered in plugin?
2. Is z-index correct for buttons?
3. Are buttons created in widget/decoration?

**Fix**:
```css
.ai-change-buttons {
  position: relative;
  z-index: 1000;  /* Ensure buttons are on top */
}
```

### Issue: Position Mismatches

**Cause**: Document modified after change created

**Fix**: Validate positions before applying:
```typescript
acceptChange: (changeId) => {
  const change = findChange(changeId);
  
  // Validate position still exists
  if (change.to > editor.state.doc.content.size) {
    console.warn("Change position out of bounds");
    rejectChange(changeId);
    return false;
  }
  
  // Apply change...
}
```

---

## Summary

The **Inline Change Tracking System** provides a Google Docs-style experience for reviewing AI-suggested changes:

1. ✅ Changes highlighted **directly in content**
2. ✅ Accept/reject buttons **inline** with text
3. ✅ Visual indicators (colors, tooltips)
4. ✅ Bulk actions (accept/reject all)
5. ✅ Yjs integration for collaboration
6. ✅ Non-intrusive (decorations, not doc modifications)

This creates a **professional, intuitive UX** for AI-assisted editing that matches users' expectations from modern collaborative editors.

---

**For complete flow documentation, see**: `AI_SIDEBAR_COMPLETE_FLOW.md`
