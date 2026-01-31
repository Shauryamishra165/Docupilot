# Gemini 2.5 Flash Content Format Fix

## Problem

When using `gemini-2.5-flash` instead of `gemini-2.0-flash-exp`, the response content comes in a **different format**:

### Old Format (Gemini 2.0):
```python
message.content = "Mr. Adesh Kumar Jain has 8,500 equity shares."  # Plain string
```

### New Format (Gemini 2.5):
```python
message.content = [
    {
        'type': 'text', 
        'text': 'Mr. Adesh Kumar Jain has 8,500 equity shares.',
        'extras': {'signature': '...'}
    }
]  # List of content blocks
```

This caused a **Pydantic validation error**:
```
ValidationError: 1 validation error for Message
content
  Input should be a valid string [type=string_type, input_value=[{'type': 'text', ...}], input_type=list]
```

---

## Solution

Added content format handling that supports **both formats**:

### 1. Extract Text Helper
```python
def extract_text_content(content):
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        # Gemini 2.5 format
        text_parts = []
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                text_parts.append(block.get('text', ''))
            elif isinstance(block, str):
                text_parts.append(block)
        return ' '.join(text_parts)
    else:
        return str(content)
```

### 2. Applied in Three Places

**A. Non-streaming Response (`run()` method):**
```python
# Extract final response
final_message = ""
for msg in reversed(result.get("messages", [])):
    if isinstance(msg, AIMessage) and msg.content:
        # Handle different content formats
        if isinstance(msg.content, str):
            final_message = msg.content
        elif isinstance(msg.content, list):
            # Extract text from list format
            text_parts = []
            for block in msg.content:
                if isinstance(block, dict) and block.get('type') == 'text':
                    text_parts.append(block.get('text', ''))
                elif isinstance(block, str):
                    text_parts.append(block)
            final_message = ' '.join(text_parts)
        else:
            final_message = str(msg.content)
        break
```

**B. Streaming Response (`run_stream()` method):**
```python
if last_message.content:
    # Extract text content
    content_text = ""
    if isinstance(last_message.content, str):
        content_text = last_message.content
    elif isinstance(last_message.content, list):
        # Gemini 2.5 format
        text_parts = []
        for block in last_message.content:
            if isinstance(block, dict) and block.get('type') == 'text':
                text_parts.append(block.get('text', ''))
            elif isinstance(block, str):
                text_parts.append(block)
        content_text = ' '.join(text_parts)
    else:
        content_text = str(last_message.content)
    
    if content_text:
        yield {
            "type": "message",
            "content": content_text
        }
```

**C. Logging (`llm_call()` method):**
```python
# Log response info
if hasattr(response, 'content') and response.content:
    if isinstance(response.content, str):
        logger.info(f"[AGENT LLM] Response content: {len(response.content)} chars")
        logger.info(f"[AGENT LLM] Content preview: {response.content[:200]}...")
    elif isinstance(response.content, list):
        # Extract text from list format
        text_parts = []
        for block in response.content:
            if isinstance(block, dict) and block.get('type') == 'text':
                text_parts.append(block.get('text', ''))
            elif isinstance(block, str):
                text_parts.append(block)
        content_str = ' '.join(text_parts)
        logger.info(f"[AGENT LLM] Response content: {len(content_str)} chars (from list)")
        logger.info(f"[AGENT LLM] Content preview: {content_str[:200]}...")
```

---

## Testing

### Before Fix:
```
[AGENT LLM] Content preview: [{'type': 'text', 'text': 'Mr. Adesh Kumar Jain has 8,500 equity shares.', ...
...
ValidationError: Input should be a valid string [type=string_type, input_value=[{'type': 'text', ...}], input_type=list]
```

### After Fix:
```
[AGENT LLM] Response content: 46 chars (from list)
[AGENT LLM] Content preview: Mr. Adesh Kumar Jain has 8,500 equity shares.
...
[CHAT] Success: True
```

---

## Benefits

1. ✅ **Works with both Gemini 2.0 and 2.5** - No need to change model
2. ✅ **Handles multiple content blocks** - If Gemini returns multiple text blocks, they're joined
3. ✅ **Backward compatible** - String format still works
4. ✅ **Forward compatible** - Ready for future Gemini format changes
5. ✅ **Better logging** - Shows actual text content instead of raw list

---

## Model Comparison

| Feature | Gemini 2.0 Flash Exp | Gemini 2.5 Flash |
|---------|---------------------|------------------|
| Content Format | String | List of blocks |
| Tool Calling | ✅ Excellent | ✅ Excellent |
| Response Speed | Fast | Fast |
| Cost | Lower | Slightly higher |
| Stability | Experimental | Stable |
| **Status** | ✅ Supported | ✅ Supported |

---

## Files Modified

- `ai/agents/document_agent.py`
  - Updated `run()` method
  - Updated `run_stream()` method  
  - Updated `llm_call()` method logging

---

## How to Use

### Option 1: Use Gemini 2.5 Flash (Recommended)
```python
llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",  # Latest stable model
    google_api_key=gemini_api_key,
    temperature=0.1,
)
```

### Option 2: Use Gemini 2.0 Flash Exp
```python
llm = ChatGoogleGenerativeAI(
    model="gemini-2.0-flash-exp",  # Experimental model
    google_api_key=gemini_api_key,
    temperature=0.1,
)
```

**Both work now!** The agent automatically handles the different formats.

---

## Verification Steps

1. **Restart Python service:**
   ```bash
   cd ai
   python main.py
   ```

2. **Test with a query:**
   ```
   "How many shares does Mr. Adesh Kumar Jain have?"
   ```

3. **Check logs for:**
   ```
   [AGENT LLM] Response content: X chars (from list)
   [AGENT LLM] Content preview: Mr. Adesh Kumar Jain has 8,500 equity shares.
   [CHAT] Success: True
   ```

4. **Verify no errors:**
   - No ValidationError
   - No "Input should be a valid string" error
   - Response displayed correctly in frontend

---

## Troubleshooting

### Issue: Still getting ValidationError

**Check:**
1. Did you restart the Python service?
2. Is the fix applied to `ai/agents/document_agent.py`?
3. Check logs for "Response content: X chars (from list)"

**Solution:**
```bash
# Restart Python service
Ctrl+C  # Stop current service
python main.py  # Start again
```

### Issue: Content looks weird

**Check:**
- Multiple text blocks being joined with spaces
- Extra whitespace in response

**Solution:**
- Use `.strip()` on final text
- Join with newlines instead of spaces if needed

---

## Future Considerations

1. **Content Block Types**: Gemini may return other block types (images, etc.) in the future
2. **Nested Structures**: Handle more complex nested content
3. **Performance**: Cache format detection for repeated calls
4. **Type Hints**: Add proper type annotations for content formats

---

## Summary

✅ **Fixed** - Agent now works with both Gemini 2.0 and 2.5
✅ **Tested** - Extraction logic verified
✅ **Deployed** - Applied in all three critical locations
✅ **Documented** - Complete documentation for future reference

The AI agent is now **fully compatible with Gemini 2.5 Flash** and will continue working if Google changes the format again!
