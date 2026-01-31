"""
Intelligent Document Agent using LangGraph

This agent has full workspace awareness and can:
- List and navigate pages in the workspace
- Read and understand document content and structure
- Perform semantic search across documents
- Edit documents while preserving formatting
- Make bulk changes like "change website name everywhere"

All logging outputs to the AI service terminal for debugging.

Uses the latest LangGraph patterns (2025/2026):
- MessagesState for clean state management
- Standard tool calling with bind_tools
- Proper ToolMessage handling
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional, Literal, Annotated, TypedDict
from datetime import datetime

# LangGraph imports - using latest API (LangGraph 1.0+)
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

# LangChain imports
from langchain_core.messages import (
    BaseMessage, 
    HumanMessage, 
    AIMessage, 
    SystemMessage, 
    ToolMessage
)
from langchain_core.tools import tool, StructuredTool
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, create_model, Field
from typing import get_type_hints, Literal

# Local imports
from tools.tool_registry import tool_registry

logger = logging.getLogger(__name__)


# ============================================================================
# EXTENDED STATE (adds context to MessagesState)
# ============================================================================

class AgentState(TypedDict):
    """
    State that persists throughout agent execution.
    Extends the standard MessagesState pattern with additional context.
    """
    # Messages with automatic append behavior (LangGraph standard)
    messages: Annotated[List[BaseMessage], add_messages]
    
    # Context from request (set once at start)
    workspace_id: str
    user_id: str
    page_id: Optional[str]
    
    # Execution tracking
    iteration: int
    tool_calls_count: int
    
    # Collected write operations to return to frontend
    pending_tool_calls: List[Dict[str, Any]]


# ============================================================================
# SYSTEM PROMPT
# ============================================================================

SYSTEM_PROMPT = """You are an intelligent document assistant with full access to a workspace of documents in Docmost.

**CRITICAL: You MUST use tools to make changes. You cannot edit documents just by responding with text.**

## Your Capabilities:

1. **Workspace Awareness**: You can list all pages, understand page hierarchy, and get metadata about any document
2. **Document Reading**: You can read the full content of any page with formatting preserved
3. **Semantic Search**: You can find content by meaning using vector search across all documents
4. **Document Editing**: You can edit documents while preserving formatting using various tools
5. **Bulk Operations**: You can make the same change across multiple occurrences (like changing a website name everywhere)

## Available Tools:

### Reading/Understanding:
- `list_workspace_pages` - List all pages in workspace to see what exists
- `get_page_structure` - Get headings and sections of a page
- `get_page_metadata` - Get page info without full content
- `read_document` - Read full page content (use format='markdown' for editing)
- `vector_search` - Find semantically related content across all pages
- `search_workspace` - Search pages by title

### Editing:
- `find_and_replace` - Find and replace text (best for simple substitutions like changing names/URLs)
- `replace_document` - Replace entire document content (for full rewrites)
- `insert_content` - Insert new content at a position (start, end, cursor)
- `insert_after_section` - **SEMANTIC INSERTION** - Insert content after a specific section/heading (e.g., "add content below the introduction")
- `replace_range` - Replace content in a specific character range
- `apply_formatting` - Apply bold, italic, etc. to text
- `clear_formatting` - Remove formatting from text

### Table Editing:
- `table_edit` - Create, modify, and update tables. Actions: create_table, add_row, delete_row, add_column, delete_column, update_cell

## Workflow for Editing Tasks:

**ALWAYS USE TOOLS - DO NOT JUST RESPOND WITH TEXT WHEN ASKED TO MAKE CHANGES!**

1. **First, understand the request** - What exactly needs to change?
2. **For simple find/replace tasks** (like "change X to Y"):
   - IMMEDIATELY use `find_and_replace` with the search and replace text
   - You don't need to read the document first for simple substitutions
3. **For semantic insertion** (like "add content below the introduction"):
   - Use `insert_after_section` with the section title and content
   - Example: insert_after_section(sectionTitle="Introduction", content="## New Section\n\nContent here...")
4. **For table operations**:
   - Use `table_edit` with the appropriate action
   - Example: table_edit(action="create_table", rows=3, columns=4)
   - Example: table_edit(action="add_row", tableIndex=0)
   - Example: table_edit(action="update_cell", tableIndex=0, rowIndex=1, columnIndex=2, content="New value")
5. **For complex changes**:
   - Use `read_document` first to understand the content
   - Then use the appropriate editing tool
6. **For bulk changes** (like "change website name everywhere"):
   - Use `find_and_replace` with `replaceAll=true` 
   - This preserves all formatting while changing the text
7. **For targeted edits**:
   - Use `find_and_replace` for simple text changes
   - Use `apply_formatting` to add formatting
   - Use `insert_content` to add new content at start/end
5. **For major rewrites**:
   - Only use `replace_document` when the entire document needs rewriting

## Important Rules:

- ALWAYS read the document first before editing (unless it's a simple find/replace)
- Use `find_and_replace` with `replaceAll=true` for bulk text changes - it's the most efficient
- Preserve formatting by using markdown content type
- Be specific in your responses - tell the user exactly what changes were made
- If a change affects multiple places, report how many occurrences were changed
- **IMPORTANT**: When the user asks a question or requests a change, you MUST use the available tools to get the information you need. Do not guess or make assumptions - use tools to read documents, search, and get context.

## Responding to Edit Operations:

When you use an editing tool (like `find_and_replace`, `insert_content`, `replace_document`), the tool returns a message indicating the change has been "queued for frontend execution". This is NORMAL and means the change WILL be applied!

**Correct response after a successful edit operation:**
- "I've updated [X] to [Y]. The change has been applied."
- "Done! I replaced [X] with [Y]."
- "I've made the requested change to your document."

**Do NOT say:**
- "I attempted to perform the action, but encountered an issue" (unless there was an actual error)
- "There was a problem" (unless the tool actually failed)

The "queued for frontend execution" message means SUCCESS, not failure!

## Current Context:
- Workspace ID: {workspace_id}
- User ID: {user_id}
- Current Page ID: {page_id}

## Editor Knowledge (Tiptap/ProseMirror):

The editor is built on Tiptap (based on ProseMirror). Documents have this structure:

**Block Types:**
- `heading` (level 1-6) - Headers and subheaders. Level 1 is the main title.
- `paragraph` - Regular text paragraphs
- `bulletList` / `orderedList` - Lists with `listItem` children
- `codeBlock` - Code blocks with syntax highlighting
- `blockquote` - Quoted text
- `table` - Tables with rows and cells
- `image` - Embedded images
- `callout` - Info/warning/error callouts

**Inline Formatting:**
- **bold**, *italic*, ~~strikethrough~~, `code`
- Links, mentions, comments

**Understanding Document Structure:**
1. Use `read_document` with `format='markdown'` to see the full content
2. Use `get_page_structure` to see headings and sections
3. Headings start with # (H1), ## (H2), ### (H3), etc. in markdown
4. The FIRST H1 is typically the page title

**Making Semantic Edits:**
1. To change a heading: Use `find_and_replace` with the heading text
2. To insert after a section: Read the document, find the section, use `insert_content` with position
3. To modify specific content: Use `find_and_replace` with exact text match

## Tool Usage Instructions:

When the user asks you to:
- **Read or understand a document**: Use `read_document` tool first
- **Find information**: Use `vector_search` or `search_workspace` tools
- **List pages**: Use `list_workspace_pages` tool
- **Get page structure**: Use `get_page_structure` tool
- **Change text everywhere**: Use `find_and_replace` with `replaceAll=true`
- **Change a heading/title**: Use `find_and_replace` with the heading text
- **Edit specific content**: Use appropriate editing tools

**IMPORTANT: For ANY edit request, you MUST use the appropriate tool. Just responding with text does NOT make changes!**

**Always use tools to get the data you need before making changes or answering questions!**"""


# ============================================================================
# TOOL DEFINITIONS (Convert from tool_registry to LangChain tools)
# ============================================================================

def json_schema_to_pydantic(json_schema: Dict[str, Any], model_name: str) -> type[BaseModel]:
    """
    Convert JSON Schema to Pydantic model dynamically.
    This creates a proper Pydantic model that LangChain can use.
    """
    properties = json_schema.get("properties", {})
    required = json_schema.get("required", [])
    
    field_definitions = {}
    
    for prop_name, prop_schema in properties.items():
        prop_type = prop_schema.get("type", "string")
        description = prop_schema.get("description", "")
        enum_values = prop_schema.get("enum")
        
        # Map JSON Schema types to Python types
        if enum_values:
            # For enums, use str type but include enum values in description
            # LangChain will use the description to guide the LLM
            python_type = str
            if description:
                description = f"{description} (valid values: {', '.join(map(str, enum_values))})"
            else:
                description = f"Valid values: {', '.join(map(str, enum_values))}"
        elif prop_type == "string":
            python_type = str
        elif prop_type == "number" or prop_type == "integer":
            python_type = float if prop_type == "number" else int
        elif prop_type == "boolean":
            python_type = bool
        elif prop_type == "array":
            python_type = list
        elif prop_type == "object":
            python_type = dict
        else:
            python_type = str  # Default to string
        
        # Make field optional if not in required list
        if prop_name not in required:
            python_type = Optional[python_type]
        
        # Create Field with description
        if prop_name not in required:
            field_definitions[prop_name] = (python_type, Field(default=None, description=description))
        else:
            field_definitions[prop_name] = (python_type, Field(description=description))
    
    # Create the Pydantic model dynamically
    try:
        model = create_model(model_name, **field_definitions)
        # Validate the model only has expected fields
        expected_fields = set(properties.keys())
        model_fields = set(model.__fields__.keys()) if hasattr(model, '__fields__') else set(model.model_fields.keys())
        if expected_fields != model_fields:
            logger.warning(f"[AGENT] Model {model_name} fields mismatch: expected {expected_fields}, got {model_fields}")
        return model
    except Exception as e:
        logger.error(f"[AGENT] Failed to create model {model_name}: {e}")
        raise


def create_langchain_tools():
    """
    Convert tool_registry tools to LangChain StructuredTool format.
    These tools will be bound to the LLM, but actual execution happens
    in tool_node via tool_registry.execute_tool()
    """
    tools = []
    
    # Get all tools from registry
    for tool_group in tool_registry.list_tools():
        for func_decl in tool_group.get("function_declarations", []):
            tool_name = func_decl.get("name")
            tool_def = tool_registry.get_tool(tool_name)
            
            if not tool_def:
                logger.warning(f"[AGENT] Tool {tool_name} not found in registry")
                continue
            
            # Get parameters schema from tool_registry
            params_schema = tool_def.parameters
            
            # Convert JSON Schema to Pydantic model
            args_model = None
            try:
                model_name = f"{tool_name}_Args"
                args_model = json_schema_to_pydantic(params_schema, model_name)
                logger.debug(f"[AGENT] Created Pydantic model for {tool_name}")
            except Exception as e:
                logger.error(f"[AGENT] Failed to create Pydantic model for {tool_name}: {e}")
                import traceback
                logger.error(f"[AGENT] Traceback:\n{traceback.format_exc()}")
                continue  # Skip this tool
            
            # Create a function that accepts Any - LangChain will use args_schema
            # This ensures LangChain uses args_schema, not function signature
            def tool_func(input: Any) -> str:
                # This is just a placeholder - actual execution in tool_node
                # The input will be a Pydantic model instance matching args_schema
                return f"Tool {tool_name} execution queued"
            
            # Create StructuredTool with explicit args_schema
            # By using a function that takes the model type, we force LangChain to use args_schema
            tool = StructuredTool(
                name=tool_name,
                description=tool_def.description,
                func=tool_func,
                args_schema=args_model,  # Explicit schema - should prevent internal params
            )
            
            tools.append(tool)
            logger.info(f"[AGENT] Created LangChain tool: {tool_name}")
    
    if not tools:
        logger.error("[AGENT] ERROR: No tools created! Check if tool_registry is populated.")
    
    return tools


# Create LangChain tools from tool_registry (will be initialized when module loads)
# But we need to ensure tool_registry is populated first
ALL_TOOLS = []
TOOLS_BY_NAME = {}

def initialize_tools():
    """Initialize tools from registry - call this after tool_registry is populated"""
    global ALL_TOOLS, TOOLS_BY_NAME
    if not ALL_TOOLS:
        ALL_TOOLS = create_langchain_tools()
        TOOLS_BY_NAME = {t.name: t for t in ALL_TOOLS}
        logger.info(f"[AGENT] Initialized {len(ALL_TOOLS)} LangChain tools from tool_registry")
    return ALL_TOOLS

# Define which tools are write operations (to be sent to frontend)
WRITE_TOOLS = {
    "find_and_replace",
    "replace_document",
    "insert_content",
    "apply_formatting",
    "clear_formatting",
    "replace_range",
    "insert_after_section",  # Semantic insertion
    "table_edit",            # Table editing
}


# ============================================================================
# LLM INITIALIZATION
# ============================================================================

def get_llm_with_tools():
    """
    Create and return the LLM with tools bound.
    Uses the latest LangChain pattern: llm.bind_tools(tools)
    """
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable is required")
    
    logger.info("[AGENT] Initializing Gemini LLM with tools")
    
    # Initialize the model (use gemini-2.0-flash for best tool calling)
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=gemini_api_key,
        temperature=0.1,
    )
    
    # Ensure tools are initialized
    tools = initialize_tools()
    if not tools:
        logger.error("[AGENT] ERROR: No tools available! Tool registry may not be populated.")
        raise ValueError("No tools available - ensure tool_registry is populated before creating agent")
    
    # Bind tools to the LLM (latest LangChain pattern)
    try:
        llm_with_tools = llm.bind_tools(tools)
        logger.info(f"[AGENT] Successfully bound {len(tools)} tools to LLM")
        logger.info(f"[AGENT] Tool names: {[t.name for t in tools]}")
    except Exception as e:
        logger.error(f"[AGENT] ERROR binding tools: {str(e)}")
        import traceback
        logger.error(f"[AGENT] Traceback:\n{traceback.format_exc()}")
        # Fallback to LLM without tools (shouldn't happen, but handle gracefully)
        llm_with_tools = llm
        logger.warning("[AGENT] Using LLM without tools as fallback")
    
    return llm_with_tools


# ============================================================================
# GRAPH NODES (following latest LangGraph patterns)
# ============================================================================

# Global LLM instance (initialized lazily)
_llm_with_tools = None

def _get_llm():
    """Get or create the LLM instance."""
    global _llm_with_tools
    if _llm_with_tools is None:
        _llm_with_tools = get_llm_with_tools()
    return _llm_with_tools

def reset_llm():
    """Reset the cached LLM instance (for testing/debugging)."""
    global _llm_with_tools
    _llm_with_tools = None
    logger.info("[AGENT] LLM instance reset")


def llm_call(state: AgentState) -> Dict[str, Any]:
    """
    LLM node that decides whether to call a tool or respond.
    Follows the latest LangGraph pattern from docs.
    """
    start_time = datetime.now()
    iteration = state.get("iteration", 0) + 1
    
    logger.info("=" * 80)
    logger.info(f"[AGENT LLM] Iteration {iteration}")
    logger.info(f"[AGENT LLM] Message count: {len(state['messages'])}")
    
    # Build system message with context
    system_content = SYSTEM_PROMPT.format(
        workspace_id=state.get("workspace_id", "unknown"),
        user_id=state.get("user_id", "unknown"),
        page_id=state.get("page_id", "not specified"),
    )
    
    # Prepare messages for the LLM
    messages_to_send = [SystemMessage(content=system_content)] + list(state["messages"])
    
    # Log the last user message
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            content_preview = msg.content[:200] if len(msg.content) > 200 else msg.content
            logger.info(f"[AGENT LLM] Last user message: {content_preview}")
            break
    
    try:
        llm = _get_llm()
        response = llm.invoke(messages_to_send)
        
        duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"[AGENT LLM] Response received in {duration:.2f}s")
        
        # Log response info
        if hasattr(response, 'content') and response.content:
            # Handle different content formats
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
            else:
                logger.info(f"[AGENT LLM] Response content type: {type(response.content)}")
                logger.info(f"[AGENT LLM] Content preview: {str(response.content)[:200]}...")
        
        # Check for tool calls - Gemini might use different format
        tool_calls = []
        if hasattr(response, 'tool_calls') and response.tool_calls:
            tool_calls = response.tool_calls
            logger.info(f"[AGENT LLM] Tool calls found: {len(tool_calls)}")
            for tc in tool_calls:
                tool_name = tc.get('name') if isinstance(tc, dict) else getattr(tc, 'name', 'unknown')
                logger.info(f"[AGENT LLM]   - Tool: {tool_name}")
        elif hasattr(response, 'response_metadata'):
            # Check response metadata for tool calls
            metadata = response.response_metadata
            if metadata and 'tool_calls' in metadata:
                tool_calls = metadata['tool_calls']
                logger.info(f"[AGENT LLM] Tool calls in metadata: {len(tool_calls)}")
        
        # If we found tool calls, ensure they're on the response
        if tool_calls and not hasattr(response, 'tool_calls'):
            # Manually add tool_calls attribute
            response.tool_calls = tool_calls
        
        logger.info("=" * 80)
        
        return {
            "messages": [response],
            "iteration": iteration,
        }
        
    except Exception as e:
        logger.error(f"[AGENT LLM] Error: {str(e)}")
        import traceback
        logger.error(f"[AGENT LLM] Traceback:\n{traceback.format_exc()}")
        
        error_response = AIMessage(content=f"I encountered an error: {str(e)}")
        return {
            "messages": [error_response],
            "iteration": iteration,
        }


def tool_node(state: AgentState) -> Dict[str, Any]:
    """
    Tool node that executes tool calls from the LLM.
    Follows the latest LangGraph pattern from docs.
    """
    start_time = datetime.now()
    messages = state["messages"]
    last_message = messages[-1]
    
    logger.info("-" * 80)
    logger.info("[AGENT TOOLS] Executing tool calls")
    logger.info(f"[AGENT TOOLS] Last message type: {type(last_message).__name__}")
    logger.info(f"[AGENT TOOLS] Has tool_calls attr: {hasattr(last_message, 'tool_calls')}")
    
    # Check for tool calls in different formats
    tool_calls = None
    if hasattr(last_message, 'tool_calls'):
        tool_calls = last_message.tool_calls
        logger.info(f"[AGENT TOOLS] tool_calls attribute: {tool_calls}")
    elif hasattr(last_message, 'tool_calls') and last_message.tool_calls is not None:
        tool_calls = last_message.tool_calls
    elif isinstance(last_message, AIMessage):
        # Check if it's a dict with tool_calls
        if hasattr(last_message, 'additional_kwargs') and 'tool_calls' in last_message.additional_kwargs:
            tool_calls = last_message.additional_kwargs['tool_calls']
            logger.info(f"[AGENT TOOLS] Found tool_calls in additional_kwargs")
    
    if not tool_calls:
        logger.warning("[AGENT TOOLS] No tool calls found in response")
        logger.warning(f"[AGENT TOOLS] Message attributes: {dir(last_message)}")
        if hasattr(last_message, 'content'):
            logger.warning(f"[AGENT TOOLS] Message content: {last_message.content[:200]}")
        return {"messages": []}
    
    logger.info(f"[AGENT TOOLS] Found {len(tool_calls)} tool call(s)")
    
    # Build context for tool execution
    context = {
        "workspaceId": state.get("workspace_id"),
        "userId": state.get("user_id"),
        "pageId": state.get("page_id"),
    }
    
    logger.info(f"[AGENT TOOLS] Context: workspace={context['workspaceId']}, page={context['pageId']}")
    logger.info(f"[AGENT TOOLS] Processing {len(tool_calls)} tool call(s)")
    
    results = []
    pending_tool_calls = list(state.get("pending_tool_calls", []))
    tool_calls_count = state.get("tool_calls_count", 0)
    
    for tool_call in tool_calls:
        # Handle different tool_call formats
        if isinstance(tool_call, dict):
            tool_name = tool_call.get("name", "")
            tool_args = tool_call.get("args", {})
            tool_id = tool_call.get("id", f"call_{tool_calls_count}")
        else:
            # ToolCall object from LangChain
            tool_name = getattr(tool_call, "name", "")
            tool_args = getattr(tool_call, "args", {})
            tool_id = getattr(tool_call, "id", f"call_{tool_calls_count}")
        
        # Convert tool_args if it's not a dict
        if not isinstance(tool_args, dict):
            if hasattr(tool_args, '__dict__'):
                tool_args = tool_args.__dict__
            elif hasattr(tool_args, 'items'):
                tool_args = dict(tool_args.items())
            else:
                logger.warning(f"[AGENT TOOLS] Could not convert tool_args to dict, using empty dict")
                tool_args = {}
        
        logger.info(f"[AGENT TOOLS] Executing: {tool_name}")
        logger.info(f"[AGENT TOOLS] Args: {json.dumps(tool_args, default=str)[:200]}")
        
        tool_start = datetime.now()
        is_write_operation = tool_name in WRITE_TOOLS
        
        if is_write_operation:
            # For write operations, collect for frontend execution
            logger.info(f"[AGENT TOOLS] Write operation: {tool_name} -> queuing for frontend")
            
            frontend_tool_call = {"tool": tool_name, "params": tool_args}
            
            # Map tool names/params for frontend compatibility
            if tool_name == "replace_document":
                frontend_tool_call["tool"] = "replace_content"
                frontend_tool_call["params"] = {
                    "content": tool_args.get("content", ""),
                    "contentType": tool_args.get("contentType", "markdown"),
                    "target": "all"
                }
            elif tool_name == "find_and_replace":
                frontend_tool_call["params"] = {
                    "searchText": tool_args.get("searchText", ""),
                    "replaceText": tool_args.get("replaceText", ""),
                    "replaceAll": tool_args.get("replaceAll", True),
                    "caseSensitive": tool_args.get("caseSensitive", False)
                }
            elif tool_name == "insert_content":
                frontend_tool_call["params"] = {
                    "content": tool_args.get("content", ""),
                    "contentType": tool_args.get("contentType", "markdown"),
                    "position": tool_args.get("position", "end")
                }
            elif tool_name == "apply_formatting":
                frontend_tool_call["params"] = {
                    "format": tool_args.get("format", ""),
                    "text": tool_args.get("text"),
                    "useFuzzy": True,
                    "attrs": tool_args.get("attrs")
                }
            elif tool_name == "insert_after_section":
                # Semantic insertion tool
                frontend_tool_call["params"] = {
                    "sectionTitle": tool_args.get("sectionTitle", ""),
                    "content": tool_args.get("content", ""),
                    "contentType": tool_args.get("contentType", "markdown")
                }
            elif tool_name == "table_edit":
                # Table editing tool
                frontend_tool_call["params"] = {
                    "action": tool_args.get("action", ""),
                    "tableIndex": tool_args.get("tableIndex", 0),
                    "rowIndex": tool_args.get("rowIndex"),
                    "columnIndex": tool_args.get("columnIndex"),
                    "content": tool_args.get("content"),
                    "rows": tool_args.get("rows", 3),
                    "columns": tool_args.get("columns", 3)
                }
            
            pending_tool_calls.append(frontend_tool_call)
            
            tool_result = {
                "success": True,
                "message": f"{tool_name} operation queued for frontend execution",
                "willExecuteOnFrontend": True
            }
        else:
            # For read operations, execute via tool registry
            logger.info(f"[AGENT TOOLS] Executing read tool: {tool_name} via tool_registry")
            logger.info(f"[AGENT TOOLS] Tool args: {json.dumps(tool_args, default=str)}")
            logger.info(f"[AGENT TOOLS] Context: {json.dumps(context, default=str)}")
            
            result = tool_registry.execute_tool(tool_name, tool_args, context)
            
            logger.info(f"[AGENT TOOLS] Tool execution result success: {result.get('success')}")
            
            if result.get("success"):
                tool_result = result.get("result", {})
                logger.info(f"[AGENT TOOLS] {tool_name} executed successfully")
                logger.info(f"[AGENT TOOLS] Result type: {type(tool_result).__name__}")
                logger.info(f"[AGENT TOOLS] Result preview: {str(tool_result)[:500]}...")
            else:
                logger.warning(f"[AGENT TOOLS] {tool_name} failed: {result.get('error')}")
                tool_result = {
                    "success": False,
                    "error": result.get("error", "Unknown error")
                }
        
        tool_duration = (datetime.now() - tool_start).total_seconds()
        logger.info(f"[AGENT TOOLS] {tool_name} completed in {tool_duration:.2f}s")
        
        # Format tool result for LLM consumption
        if isinstance(tool_result, dict):
            # If it's a dict, convert to readable string format
            if tool_result.get("success"):
                # For successful results, format nicely
                result_content = tool_result.get("result", tool_result)
                if isinstance(result_content, dict):
                    # Format dict results as readable text
                    content_str = json.dumps(result_content, indent=2, default=str)
                elif isinstance(result_content, str):
                    content_str = result_content
                else:
                    content_str = str(result_content)
            else:
                # For errors, include error message
                content_str = f"Error: {tool_result.get('error', 'Unknown error')}"
        else:
            content_str = str(tool_result)
        
        logger.info(f"[AGENT TOOLS] Tool result content length: {len(content_str)} chars")
        
        # Create ToolMessage with result
        results.append(ToolMessage(
            content=content_str,
            tool_call_id=tool_id,
            name=tool_name,
        ))
        
        tool_calls_count += 1
    
    total_duration = (datetime.now() - start_time).total_seconds()
    logger.info(f"[AGENT TOOLS] All tools completed in {total_duration:.2f}s")
    logger.info("-" * 80)
    
    return {
        "messages": results,
        "tool_calls_count": tool_calls_count,
        "pending_tool_calls": pending_tool_calls,
    }


def should_continue(state: AgentState) -> Literal["tools", "__end__"]:
    """
    Conditional edge: decide whether to continue to tools or end.
    Follows the latest LangGraph pattern.
    """
    messages = state["messages"]
    
    if not messages:
        return END
    
    last_message = messages[-1]
    iteration = state.get("iteration", 0)
    
    # Prevent infinite loops
    if iteration >= 10:
        logger.warning(f"[AGENT ROUTER] Max iterations ({iteration}), stopping")
        return END
    
    # Check for tool calls in different formats
    has_tool_calls = False
    if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
        has_tool_calls = True
    elif isinstance(last_message, AIMessage):
        if hasattr(last_message, 'additional_kwargs') and 'tool_calls' in last_message.additional_kwargs:
            tool_calls = last_message.additional_kwargs['tool_calls']
            if tool_calls:
                has_tool_calls = True
    
    # If LLM made tool calls, execute them
    if has_tool_calls:
        logger.info(f"[AGENT ROUTER] -> tools (iteration {iteration})")
        return "tools"
    
    # Otherwise, we're done
    logger.info(f"[AGENT ROUTER] -> end (iteration {iteration})")
    return END


# ============================================================================
# BUILD THE GRAPH
# ============================================================================

def create_document_agent():
    """
    Build and compile the document agent graph.
    Uses the latest LangGraph StateGraph pattern.
    
    Graph structure:
        START -> llm_call -> [tool_node -> llm_call]* -> END
    """
    logger.info("[AGENT] Building document agent graph")
    
    # Ensure tools are initialized
    initialize_tools()
    
    # Create graph with our state type
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("llm_call", llm_call)
    graph.add_node("tools", tool_node)
    
    # Add edges (following latest LangGraph pattern)
    graph.add_edge(START, "llm_call")
    graph.add_conditional_edges(
        "llm_call",
        should_continue,
        {"tools": "tools", END: END}
    )
    graph.add_edge("tools", "llm_call")
    
    # Compile
    agent = graph.compile()
    
    logger.info("[AGENT] Document agent graph compiled")
    logger.info(f"[AGENT] Available tools: {len(ALL_TOOLS)}")
    
    return agent


# ============================================================================
# DOCUMENT AGENT CLASS
# ============================================================================

class DocumentAgent:
    """
    High-level interface for the document agent.
    """
    
    def __init__(self):
        logger.info("[DocumentAgent] Initializing...")
        self._agent = None
        self._initialized = False
    
    def _ensure_initialized(self):
        if not self._initialized:
            self._agent = create_document_agent()
            self._initialized = True
            logger.info("[DocumentAgent] Agent initialized")
    
    async def run(
        self,
        query: str,
        workspace_id: str,
        user_id: str,
        page_id: Optional[str] = None,
        message_history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Run the agent with a user query (non-streaming version).
        """
        start_time = datetime.now()
        
        logger.info("=" * 80)
        logger.info("[DocumentAgent] Starting run")
        logger.info(f"[DocumentAgent] Query: {query[:100]}...")
        logger.info(f"[DocumentAgent] Workspace: {workspace_id}, Page: {page_id}")
        
        self._ensure_initialized()
        
        # Build messages
        messages: List[BaseMessage] = []
        
        if message_history:
            for msg in message_history:
                if msg.get("role") == "user":
                    messages.append(HumanMessage(content=msg.get("content", "")))
                elif msg.get("role") == "assistant":
                    messages.append(AIMessage(content=msg.get("content", "")))
        
        messages.append(HumanMessage(content=query))
        
        # Initial state
        initial_state: AgentState = {
            "messages": messages,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "page_id": page_id,
            "iteration": 0,
            "tool_calls_count": 0,
            "pending_tool_calls": [],
        }
        
        try:
            # Run the agent (sync invoke)
            result = self._agent.invoke(initial_state)
            
            duration = (datetime.now() - start_time).total_seconds()
            
            # Extract final response
            final_message = ""
            for msg in reversed(result.get("messages", [])):
                if isinstance(msg, AIMessage) and msg.content:
                    # Handle different content formats from different Gemini models
                    if isinstance(msg.content, str):
                        final_message = msg.content
                    elif isinstance(msg.content, list):
                        # Gemini 2.5 returns list of content blocks
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
            
            pending_tool_calls = result.get("pending_tool_calls", [])
            
            logger.info("=" * 80)
            logger.info(f"[DocumentAgent] Completed in {duration:.2f}s")
            logger.info(f"[DocumentAgent] Iterations: {result.get('iteration', 0)}")
            logger.info(f"[DocumentAgent] Pending tool calls: {len(pending_tool_calls)}")
            logger.info("=" * 80)
            
            return {
                "message": final_message,
                "toolCalls": pending_tool_calls if pending_tool_calls else None,
                "success": True,
                "metadata": {
                    "iterations": result.get("iteration", 0),
                    "tool_calls_count": result.get("tool_calls_count", 0),
                    "duration_seconds": duration,
                }
            }
            
        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"[DocumentAgent] Failed after {duration:.2f}s: {str(e)}")
            import traceback
            logger.error(f"[DocumentAgent] Traceback:\n{traceback.format_exc()}")
            
            return {
                "message": f"I encountered an error: {str(e)}",
                "toolCalls": None,
                "success": False,
                "error": str(e),
            }
    
    async def run_stream(
        self,
        query: str,
        workspace_id: str,
        user_id: str,
        page_id: Optional[str] = None,
        message_history: Optional[List[Dict[str, str]]] = None,
    ):
        """
        Run the agent with streaming output.
        Yields events as they occur (tool calls, LLM responses, etc.)
        """
        start_time = datetime.now()
        
        logger.info("=" * 80)
        logger.info("[DocumentAgent STREAM] Starting streaming run")
        logger.info(f"[DocumentAgent STREAM] Query: {query[:100]}...")
        logger.info(f"[DocumentAgent STREAM] Workspace: {workspace_id}, Page: {page_id}")
        
        self._ensure_initialized()
        
        # Build messages
        messages: List[BaseMessage] = []
        
        if message_history:
            for msg in message_history:
                if msg.get("role") == "user":
                    messages.append(HumanMessage(content=msg.get("content", "")))
                elif msg.get("role") == "assistant":
                    messages.append(AIMessage(content=msg.get("content", "")))
        
        messages.append(HumanMessage(content=query))
        
        # Initial state
        initial_state: AgentState = {
            "messages": messages,
            "workspace_id": workspace_id,
            "user_id": user_id,
            "page_id": page_id,
            "iteration": 0,
            "tool_calls_count": 0,
            "pending_tool_calls": [],
        }
        
        try:
            # Stream the agent execution with updates mode
            logger.info("[DocumentAgent STREAM] Starting astream...")
            async for chunk in self._agent.astream(initial_state, stream_mode="updates"):
                logger.info(f"[DocumentAgent STREAM] Chunk keys: {list(chunk.keys())}")
                
                # Process different types of chunks (updates mode returns node_name: updates)
                for node_name, node_output in chunk.items():
                    logger.info(f"[DocumentAgent STREAM] Node: {node_name}")
                    
                    if node_name == "llm_call":
                        # LLM response - extract the message
                        messages_list = node_output.get("messages", [])
                        logger.info(f"[DocumentAgent STREAM] LLM messages: {len(messages_list)}")
                        
                        if messages_list:
                            last_message = messages_list[-1]
                            logger.info(f"[DocumentAgent STREAM] Last message type: {type(last_message).__name__}")
                            
                            if isinstance(last_message, AIMessage):
                                # Check if this is a tool call or text response
                                has_tool_calls = False
                                
                                # Check tool_calls attribute
                                if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                                    has_tool_calls = True
                                
                                # Also check additional_kwargs for tool calls (some models use this format)
                                if not has_tool_calls and hasattr(last_message, 'additional_kwargs'):
                                    ak_tool_calls = last_message.additional_kwargs.get('tool_calls')
                                    if ak_tool_calls:
                                        has_tool_calls = True
                                        # Copy to tool_calls for uniform handling
                                        if not hasattr(last_message, 'tool_calls') or not last_message.tool_calls:
                                            last_message.tool_calls = ak_tool_calls
                                
                                logger.info(f"[DocumentAgent STREAM] Has tool calls: {has_tool_calls}")
                                logger.info(f"[DocumentAgent STREAM] Message content type: {type(last_message.content)}")
                                if hasattr(last_message, 'additional_kwargs'):
                                    logger.info(f"[DocumentAgent STREAM] Additional kwargs: {list(last_message.additional_kwargs.keys())}")
                                
                                if has_tool_calls:
                                    # Send tool calls event
                                    tool_calls_data = []
                                    for tc in last_message.tool_calls:
                                        tool_name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", "")
                                        tool_args = tc.get("args", {}) if isinstance(tc, dict) else getattr(tc, "args", {})
                                        tool_calls_data.append({
                                            "name": tool_name,
                                            "args": tool_args
                                        })
                                    
                                    logger.info(f"[DocumentAgent STREAM] Yielding tool_calls: {[tc['name'] for tc in tool_calls_data]}")
                                    yield {
                                        "type": "tool_calls",
                                        "tool_calls": tool_calls_data
                                    }
                                
                                if last_message.content:
                                    # Extract text content (handle different formats from different Gemini models)
                                    content_text = ""
                                    if isinstance(last_message.content, str):
                                        content_text = last_message.content
                                    elif isinstance(last_message.content, list):
                                        # Gemini 2.5 returns list of content blocks
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
                                        # Send text response
                                        logger.info(f"[DocumentAgent STREAM] Yielding message: {content_text[:50]}...")
                                        yield {
                                            "type": "message",
                                            "content": content_text
                                        }
                    
                    elif node_name == "tools":
                        # Tool execution results
                        messages_list = node_output.get("messages", [])
                        pending_tools = node_output.get("pending_tool_calls", [])
                        
                        logger.info(f"[DocumentAgent STREAM] Tools node - messages: {len(messages_list)}, pending: {len(pending_tools)}")
                        
                        # Send tool execution events
                        for msg in messages_list:
                            if isinstance(msg, ToolMessage):
                                logger.info(f"[DocumentAgent STREAM] Tool result: {msg.name}")
                                yield {
                                    "type": "tool_result",
                                    "tool_name": msg.name,
                                    "content": msg.content[:200] + "..." if len(msg.content) > 200 else msg.content
                                }
                        
                        # Send pending tool calls for frontend execution
                        if pending_tools:
                            logger.info(f"[DocumentAgent STREAM] Yielding pending_tools: {len(pending_tools)}")
                            for tool in pending_tools:
                                logger.info(f"[DocumentAgent STREAM] Pending tool: {tool.get('tool', 'unknown')}")
                            yield {
                                "type": "pending_tools",
                                "tools": pending_tools
                            }
            
            duration = (datetime.now() - start_time).total_seconds()
            
            logger.info("=" * 80)
            logger.info(f"[DocumentAgent STREAM] Stream completed in {duration:.2f}s")
            logger.info("=" * 80)
            
            # Send final completion event
            yield {
                "type": "done",
                "metadata": {
                    "duration_seconds": duration
                }
            }
            
        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"[DocumentAgent STREAM] Stream failed after {duration:.2f}s: {str(e)}")
            import traceback
            logger.error(f"[DocumentAgent STREAM] Traceback:\n{traceback.format_exc()}")
            
            yield {
                "type": "error",
                "error": str(e)
            }


# ============================================================================
# MODULE-LEVEL CONVENIENCE
# ============================================================================

_document_agent: Optional[DocumentAgent] = None


def get_document_agent() -> DocumentAgent:
    """Get or create the singleton document agent."""
    global _document_agent
    if _document_agent is None:
        _document_agent = DocumentAgent()
    return _document_agent


async def run_document_agent(
    query: str,
    workspace_id: str,
    user_id: str,
    page_id: Optional[str] = None,
    message_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Convenience function to run the document agent.
    """
    agent = get_document_agent()
    return await agent.run(
        query=query,
        workspace_id=workspace_id,
        user_id=user_id,
        page_id=page_id,
        message_history=message_history,
    )
