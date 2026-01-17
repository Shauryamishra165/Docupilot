from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai
from tools.tool_registry import tool_registry
from tools.document_tools import register_document_tools

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Load environment variables from .env file in the same directory as this script
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

app = FastAPI(title="Docmost AI Service", version="1.0.0")

# CORS middleware - restrict to backend origin for security
# In production, set ALLOWED_ORIGINS environment variable
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "X-Workspace-Id", "X-User-Id", "X-Page-Id"],
    expose_headers=["Content-Type"],
)

# Configuration
API_KEY = os.getenv("API_KEY", "parth128")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Chat history storage directory
CHAT_HISTORY_DIR = Path(__file__).parent / "chat_history"
CHAT_HISTORY_DIR.mkdir(exist_ok=True)

# Debug: Log if API key is loaded (without showing the actual key)
logger.info(f"API_KEY loaded: {'Yes' if API_KEY else 'No'}")
logger.info(f"GEMINI_API_KEY loaded: {'Yes' if GEMINI_API_KEY and GEMINI_API_KEY != 'your-gemini-api-key-here' else 'No'}")

if not GEMINI_API_KEY or GEMINI_API_KEY == "your-gemini-api-key-here":
    raise ValueError(
        "GEMINI_API_KEY environment variable is required. "
        "Please set it in the .env file. Get your key from: https://makersuite.google.com/app/apikey"
    )

# Initialize Gemini
try:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.5-flash")
    logger.info("Gemini model initialized successfully")
    logger.info(f"Model name: gemini-2.5-flash")
except Exception as e:
    logger.error(f"Error initializing Gemini: {e}")
    raise

# Register all tools
register_document_tools(tool_registry)
tools_list = tool_registry.list_tools()
logger.info(f"Tool registry initialized: {len(tools_list)} tool group(s) registered")
for tool_group in tools_list:
    func_decls = tool_group.get("function_declarations", [])
    for func_decl in func_decls:
        logger.info(f"  - Registered tool: {func_decl.get('name')}")

# Request/Response models
class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    pageId: Optional[str] = None  # Current page ID (optional, for context)

class ChatResponse(BaseModel):
    message: str
    success: bool = True
    chatId: Optional[str] = None

class ChatHistoryItem(BaseModel):
    id: str
    title: str
    createdAt: str
    messageCount: int

# Document reading models
class DocumentReadRequest(BaseModel):
    pageId: str
    title: str
    content: str
    format: str  # 'json', 'text', 'html', 'markdown'
    metadata: Optional[dict] = None

class DocumentReadResponse(BaseModel):
    pageId: str
    title: str
    content: str  # Processed content (can be same as input or AI-processed)
    format: str
    metadata: Optional[dict] = None
    success: bool = True

# Authentication dependency
def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ai-service"}

def save_chat_history(chat_id: str, messages: List[Message], workspace_id: str, user_id: str):
    """Save chat history to a JSON file"""
    chat_file = CHAT_HISTORY_DIR / f"{workspace_id}_{user_id}_{chat_id}.json"
    
    # Generate title from first user message
    title = "New Chat"
    for msg in messages:
        if msg.role == "user":
            title = msg.content[:50] + ("..." if len(msg.content) > 50 else "")
            break
    
    chat_data = {
        "id": chat_id,
        "title": title,
        "workspaceId": workspace_id,
        "userId": user_id,
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat(),
        "messages": [{"role": msg.role, "content": msg.content} for msg in messages]
    }
    
    with open(chat_file, "w", encoding="utf-8") as f:
        json.dump(chat_data, f, indent=2, ensure_ascii=False)
    
    return chat_data

def load_chat_history(chat_id: str, workspace_id: str, user_id: str) -> Optional[dict]:
    """Load chat history from a JSON file"""
    chat_file = CHAT_HISTORY_DIR / f"{workspace_id}_{user_id}_{chat_id}.json"
    
    if not chat_file.exists():
        return None
    
    with open(chat_file, "r", encoding="utf-8") as f:
        return json.load(f)

def list_chat_history(workspace_id: str, user_id: str) -> List[dict]:
    """List all chat histories for a user in a workspace"""
    prefix = f"{workspace_id}_{user_id}_"
    chats = []
    
    for chat_file in CHAT_HISTORY_DIR.glob(f"{prefix}*.json"):
        try:
            with open(chat_file, "r", encoding="utf-8") as f:
                chat_data = json.load(f)
                chats.append({
                    "id": chat_data.get("id"),
                    "title": chat_data.get("title", "Untitled Chat"),
                    "createdAt": chat_data.get("createdAt"),
                    "messageCount": len(chat_data.get("messages", []))
                })
        except Exception as e:
            print(f"Error reading chat file {chat_file}: {e}")
            continue
    
    # Sort by creation date, newest first
    chats.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return chats

@app.post("/api/chat", dependencies=[Depends(verify_api_key)])
async def chat(
    request: ChatRequest,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_page_id: Optional[str] = Header(None)
):
    """
    Chat endpoint with tool support
    
    Context is automatically passed from headers:
    - x_workspace_id: Current workspace ID
    - x_user_id: Current user ID
    - x_page_id: Current page ID (if available)
    
    The pageId can also be passed in the request body, which takes precedence over the header.
    """
    start_time = datetime.now()
    chat_id = str(uuid.uuid4())
    
    try:
        # Prepare context for tools (workspace, user, page)
        page_id = request.pageId or x_page_id
        context = {
            "workspaceId": x_workspace_id,
            "userId": x_user_id,
            "pageId": page_id,
        }
        
        logger.info("=" * 80)
        logger.info(f"[CHAT REQUEST] Chat ID: {chat_id}")
        logger.info(f"[CHAT REQUEST] Workspace ID: {x_workspace_id}")
        logger.info(f"[CHAT REQUEST] User ID: {x_user_id}")
        logger.info(f"[CHAT REQUEST] Page ID: {page_id}")
        logger.info(f"[CHAT REQUEST] Message count: {len(request.messages)}")
        logger.info(f"[CHAT REQUEST] Last user message: {request.messages[-1].content[:100]}..." if len(request.messages[-1].content) > 100 else f"[CHAT REQUEST] Last user message: {request.messages[-1].content}")
        
        # Build conversation history from previous messages (excluding the last user message)
        history = []
        for msg in request.messages[:-1]:  # Exclude last message
            if msg.role == "user":
                history.append({"role": "user", "parts": [msg.content]})
            elif msg.role == "assistant":
                history.append({"role": "model", "parts": [msg.content]})
        
        logger.info(f"[CHAT PROCESSING] Built conversation history with {len(history)} previous messages")
        
        # Get the last user message
        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from user")
        
        # Log context information (workspace, user, page IDs are available in headers/body)
        if page_id:
            logger.info(f"[CONTEXT] Page ID available: {page_id} (AI can use read_document tool if needed)")
        
        # Get tools for function calling
        tools = tool_registry.list_tools()
        logger.info(f"[TOOL REGISTRY] Available tools: {len(tools)} tool group(s) registered")
        if tools:
            for tool_group in tools:
                func_decls = tool_group.get("function_declarations", [])
                logger.info(f"[TOOL REGISTRY] Tool group has {len(func_decls)} function(s)")
                for func_decl in func_decls:
                    logger.info(f"[TOOL REGISTRY] - Tool: {func_decl.get('name')} - {func_decl.get('description', '')[:50]}")
        
        # Start a chat session with history
        logger.info("[LLM] Starting chat session with Gemini")
        logger.info(f"[LLM] History messages: {len(history)}")
        chat_session = model.start_chat(history=history)
        
        logger.info(f"[LLM] Sending message to Gemini model")
        logger.info(f"[LLM INPUT] User message length: {len(last_message.content)} characters")
        logger.info(f"[LLM INPUT] User message preview: {last_message.content[:200]}..." if len(last_message.content) > 200 else f"[LLM INPUT] User message: {last_message.content}")
        
        # Try to use function calling if available (requires google-generativeai >= 0.8.0)
        try:
            if tools:
                logger.info(f"[LLM] Attempting to use function calling with {len(tools)} tool group(s)")
                # Try passing tools to send_message (works with newer API versions)
                response = chat_session.send_message(last_message.content, tools=tools)
                logger.info(f"[LLM] Function calling enabled - AI can automatically use tools")
            else:
                logger.info("[LLM] No tools registered, sending without function calling")
                response = chat_session.send_message(last_message.content)
        except TypeError as e:
            # Fallback if tools parameter not supported (old API version)
            logger.warning(f"[LLM] Function calling not supported in this API version: {str(e)}")
            logger.info("[LLM] Falling back to sending without tools (using auto-read workaround)")
            response = chat_session.send_message(last_message.content)
        except Exception as e:
            logger.error(f"[LLM] Error sending message: {str(e)}")
            logger.info("[LLM] Falling back to sending without tools")
            response = chat_session.send_message(last_message.content)
        
        logger.info(f"[LLM OUTPUT] Received response from Gemini")
        logger.info(f"[LLM OUTPUT] Response type: {type(response).__name__}")
        
        # Safely get response text (may fail if response contains function calls)
        response_text = ""
        try:
            if hasattr(response, 'text'):
                response_text = response.text
                logger.info(f"[LLM OUTPUT] Response text length: {len(response_text)} characters")
                if response_text:
                    preview = response_text[:300] + "..." if len(response_text) > 300 else response_text
                    logger.info(f"[LLM OUTPUT] Response preview: {preview}")
        except ValueError as e:
            # Response contains function calls, can't convert to text directly
            logger.info(f"[LLM OUTPUT] Response contains function calls (cannot convert to text: {str(e)})")
            response_text = ""
        
        # Handle function calls if any
        final_response_text = response_text
        function_calls_processed = []
        max_iterations = 5  # Prevent infinite loops
        iteration = 0
        
        # Check if response contains function calls
        # Note: Function calling may not work with google-generativeai 0.3.2
        logger.info("[LLM] Checking response structure for function calls...")
        if hasattr(response, 'candidates') and response.candidates:
            logger.info(f"[LLM] Response has {len(response.candidates)} candidate(s)")
            candidate = response.candidates[0]
            logger.info(f"[LLM] Candidate type: {type(candidate).__name__}")
            if hasattr(candidate, 'content') and candidate.content:
                if hasattr(candidate.content, 'parts'):
                    parts = candidate.content.parts
                    logger.info(f"[LLM] Response has {len(parts)} part(s)")
                    for i, part in enumerate(parts):
                        logger.info(f"[LLM] Part {i} type: {type(part).__name__}")
                        # Check for function calls without accessing .text
                        if hasattr(part, 'function_call') and part.function_call:
                            func_name = getattr(part.function_call, 'name', None)
                            if func_name and func_name.strip():
                                logger.info(f"[LLM] FUNCTION CALL DETECTED in part {i}: {func_name}")
                            else:
                                logger.info(f"[LLM] Part {i} has function_call attribute but name is empty")
        
        while iteration < max_iterations:
            iteration += 1
            function_call_found = False
            
            if hasattr(response, 'candidates') and response.candidates:
                candidate = response.candidates[0]
                if hasattr(candidate, 'content') and candidate.content:
                    parts = candidate.content.parts
                    for part in parts:
                        # Check if this part is actually a function call with a valid name
                        if hasattr(part, 'function_call') and part.function_call:
                            # Get function name and validate it's not empty
                            function_name = getattr(part.function_call, 'name', None)
                            if not function_name or not function_name.strip():
                                logger.warning(f"[TOOL EXECUTION] Detected function_call but name is empty, skipping this part")
                                continue
                            
                            function_call_found = True
                            # Get function arguments
                            function_args_raw = getattr(part.function_call, 'args', None)
                            function_args = {}
                            if function_args_raw:
                                if isinstance(function_args_raw, str):
                                    try:
                                        function_args = json.loads(function_args_raw)
                                    except json.JSONDecodeError:
                                        logger.warning(f"[TOOL EXECUTION] Failed to parse function args as JSON, using empty dict")
                                        function_args = {}
                                else:
                                    # Convert MapComposite or other dict-like objects to regular dict
                                    try:
                                        if hasattr(function_args_raw, '__iter__') and not isinstance(function_args_raw, str):
                                            # Try to convert to dict (works for MapComposite, dict, etc.)
                                            if hasattr(function_args_raw, 'items'):
                                                function_args = dict(function_args_raw.items())
                                            elif hasattr(function_args_raw, '__dict__'):
                                                function_args = dict(function_args_raw.__dict__)
                                            else:
                                                # Try to iterate and build dict
                                                try:
                                                    function_args = dict(function_args_raw)
                                                except (TypeError, ValueError):
                                                    logger.warning(f"[TOOL EXECUTION] Could not convert function args to dict, using empty dict")
                                                    function_args = {}
                                        else:
                                            function_args = function_args_raw
                                    except Exception as e:
                                        logger.warning(f"[TOOL EXECUTION] Error converting function args to dict: {str(e)}, using empty dict")
                                        function_args = {}
                            
                            logger.info("=" * 80)
                            logger.info(f"[TOOL EXECUTION] Iteration {iteration}")
                            logger.info(f"[TOOL EXECUTION] Function name: {function_name}")
                            # Safely serialize function arguments (may contain non-JSON types from Gemini)
                            try:
                                function_args_str = json.dumps(function_args, indent=2, default=str)
                                logger.info(f"[TOOL EXECUTION] Function arguments: {function_args_str}")
                            except (TypeError, ValueError) as e:
                                # If serialization fails, convert to string representation
                                logger.info(f"[TOOL EXECUTION] Function arguments: {str(function_args)}")
                            logger.info(f"[TOOL EXECUTION] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
                            
                            # Execute tool
                            tool_start_time = datetime.now()
                            tool_result = tool_registry.execute_tool(function_name, function_args, context)
                            tool_duration = (datetime.now() - tool_start_time).total_seconds()
                            
                            logger.info(f"[TOOL EXECUTION] Tool executed in {tool_duration:.2f}s")
                            logger.info(f"[TOOL EXECUTION] Tool result success: {tool_result.get('success', False)}")
                            if tool_result.get('success'):
                                logger.info(f"[TOOL EXECUTION] Tool result preview: {str(tool_result.get('result', {}))[:200]}...")
                            else:
                                logger.warning(f"[TOOL EXECUTION] Tool error: {tool_result.get('error', 'Unknown error')}")
                            
                            function_calls_processed.append({
                                "name": function_name,
                                "result": tool_result,
                                "duration": tool_duration
                            })
                            
                            # Send function result back to model
                            # Only send if tool execution was successful
                            if tool_result.get('success', False):
                                logger.info(f"[LLM] Sending tool result back to Gemini for function: {function_name}")
                                try:
                                    function_response = chat_session.send_message({
                                        "function_response": {
                                            "name": function_name,
                                            "response": tool_result.get('result', {})
                                        }
                                    })
                                    response = function_response
                                    # Safely get text from function response
                                    try:
                                        if hasattr(function_response, 'text'):
                                            final_response_text = function_response.text
                                            logger.info(f"[LLM OUTPUT] Updated response after tool execution: {len(final_response_text)} characters")
                                        else:
                                            logger.info(f"[LLM OUTPUT] Function response has no text attribute")
                                    except ValueError as e:
                                        # Function response might contain another function call
                                        logger.info(f"[LLM OUTPUT] Function response contains function calls, will process in next iteration")
                                        final_response_text = ""  # Will be updated in next iteration
                                except Exception as e:
                                    logger.error(f"[LLM] Error sending function response back to Gemini: {str(e)}")
                                    # Continue with the original response if sending function response fails
                                    logger.info("[LLM] Continuing with original response")
                            else:
                                logger.warning(f"[LLM] Tool execution failed, not sending function response to Gemini")
                                logger.warning(f"[LLM] Error: {tool_result.get('error', 'Unknown error')}")
                            break
            
            if not function_call_found:
                if iteration == 1:
                    logger.info("[LLM] No function calls detected in response (this is normal with current API version)")
                break
        
        if iteration >= max_iterations:
            logger.warning(f"[TOOL EXECUTION] Reached maximum iterations ({max_iterations}), stopping function call loop")
        elif iteration > 0:
            logger.info(f"[TOOL EXECUTION] Processed {len(function_calls_processed)} function call(s) in {iteration} iteration(s)")
        
        total_duration = (datetime.now() - start_time).total_seconds()
        logger.info("=" * 80)
        logger.info(f"[CHAT COMPLETE] Chat ID: {chat_id}")
        logger.info(f"[CHAT COMPLETE] Total duration: {total_duration:.2f}s")
        logger.info(f"[CHAT COMPLETE] Function calls executed: {len(function_calls_processed)}")
        logger.info(f"[CHAT COMPLETE] Final response length: {len(final_response_text)} characters")
        logger.info(f"[CHAT COMPLETE] Response preview: {final_response_text[:200]}..." if len(final_response_text) > 200 else f"[CHAT COMPLETE] Response: {final_response_text}")
        logger.info("=" * 80)
        
        # Add assistant response to messages
        all_messages = request.messages + [Message(role="assistant", content=final_response_text)]
        
        # Save chat history if workspace and user IDs are provided
        if x_workspace_id and x_user_id:
            logger.info(f"[CHAT HISTORY] Saving chat history for workspace={x_workspace_id}, user={x_user_id}")
            save_chat_history(chat_id, all_messages, x_workspace_id, x_user_id)
            logger.info(f"[CHAT HISTORY] Chat history saved with ID: {chat_id}")
        
        return ChatResponse(
            message=final_response_text,
            success=True,
            chatId=chat_id
        )
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        total_duration = (datetime.now() - start_time).total_seconds()
        logger.error("=" * 80)
        logger.error(f"[CHAT ERROR] Chat ID: {chat_id}")
        logger.error(f"[CHAT ERROR] Duration before error: {total_duration:.2f}s")
        logger.error(f"[CHAT ERROR] Error type: {type(e).__name__}")
        logger.error(f"[CHAT ERROR] Error message: {error_msg}")
        logger.error(f"[CHAT ERROR] Workspace: {x_workspace_id}, User: {x_user_id}, Page: {request.pageId or x_page_id}")
        import traceback
        logger.error(f"[CHAT ERROR] Traceback:\n{traceback.format_exc()}")
        logger.error("=" * 80)
        
        # Provide more helpful error messages
        if "API key" in error_msg or "API_KEY" in error_msg:
            raise HTTPException(
                status_code=500,
                detail="Invalid Gemini API key. Please check your GEMINI_API_KEY in the .env file."
            )
        raise HTTPException(status_code=500, detail=f"Error generating response: {error_msg}")

@app.get("/api/history", dependencies=[Depends(verify_api_key)])
async def get_chat_history(
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None)
):
    """Get list of all chat histories for a user"""
    if not x_workspace_id or not x_user_id:
        raise HTTPException(status_code=400, detail="Workspace ID and User ID are required")
    
    chats = list_chat_history(x_workspace_id, x_user_id)
    return {"history": chats}

@app.get("/api/history/{chat_id}", dependencies=[Depends(verify_api_key)])
async def get_chat(
    chat_id: str,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None)
):
    """Get a specific chat history"""
    if not x_workspace_id or not x_user_id:
        raise HTTPException(status_code=400, detail="Workspace ID and User ID are required")
    
    chat_data = load_chat_history(chat_id, x_workspace_id, x_user_id)
    if not chat_data:
        raise HTTPException(status_code=404, detail="Chat not found")
    
    return {
        "id": chat_data["id"],
        "title": chat_data.get("title", "Untitled Chat"),
        "messages": chat_data.get("messages", [])
    }

@app.delete("/api/history/{chat_id}", dependencies=[Depends(verify_api_key)])
async def delete_chat(
    chat_id: str,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None)
):
    """Delete a chat history"""
    if not x_workspace_id or not x_user_id:
        raise HTTPException(status_code=400, detail="Workspace ID and User ID are required")
    
    chat_file = CHAT_HISTORY_DIR / f"{x_workspace_id}_{x_user_id}_{chat_id}.json"
    
    if not chat_file.exists():
        raise HTTPException(status_code=404, detail="Chat not found")
    
    try:
        chat_file.unlink()
        return {"success": True, "message": "Chat deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting chat: {str(e)}")

@app.post("/api/document/read", dependencies=[Depends(verify_api_key)])
async def read_document(
    request: DocumentReadRequest,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_page_id: Optional[str] = Header(None)
):
    """
    Read and process document content
    
    This endpoint receives document content from the backend and can process it
    using AI or other services. For now, it returns the content as-is, but can
    be extended to perform:
    - Content summarization
    - Content analysis
    - Content extraction
    - Content transformation
    
    Parameters (from request body):
    - pageId: UUID of the page
    - title: Page title
    - content: Formatted content (text, HTML, JSON, or markdown)
    - format: Format of the content ('json', 'text', 'html', 'markdown')
    - metadata: Optional metadata (word count, character count, etc.)
    
    Headers:
    - X-API-Key: Authentication key
    - X-Workspace-Id: Workspace ID
    - X-User-Id: User ID
    - X-Page-Id: Page ID
    
    Returns:
    - DocumentReadResponse with processed content
    """
    start_time = datetime.now()
    logger.info("=" * 80)
    logger.info("[DOCUMENT READ] Received document read request")
    logger.info(f"[DOCUMENT READ] Page ID: {request.pageId}")
    logger.info(f"[DOCUMENT READ] Page Title: {request.title}")
    logger.info(f"[DOCUMENT READ] Format: {request.format}")
    logger.info(f"[DOCUMENT READ] Content Length: {len(request.content)} characters")
    logger.info(f"[DOCUMENT READ] Workspace ID: {x_workspace_id}")
    logger.info(f"[DOCUMENT READ] User ID: {x_user_id}")
    logger.info(f"[DOCUMENT READ] Page ID (header): {x_page_id}")
    if request.metadata:
        logger.info(f"[DOCUMENT READ] Metadata: wordCount={request.metadata.get('wordCount', 'N/A')}, charCount={request.metadata.get('characterCount', 'N/A')}")
    
    try:
        # For now, return the content as-is
        # In the future, you can add AI processing here:
        # - Summarize content
        # - Extract key points
        # - Analyze sentiment
        # - Extract entities
        # - Transform format
        
        logger.info("[DOCUMENT READ] Processing document content (currently returning as-is)")
        processed_content = request.content
        
        # Example: You could add AI processing like this:
        # if request.format == 'text' and len(request.content) > 1000:
        #     logger.info("[DOCUMENT READ] Content is long, generating summary...")
        #     prompt = f"Summarize the following document:\n\n{request.content[:5000]}"
        #     response = model.generate_content(prompt)
        #     processed_content = response.text
        #     logger.info(f"[DOCUMENT READ] Summary generated: {len(processed_content)} characters")
        
        duration = (datetime.now() - start_time).total_seconds()
        logger.info(f"[DOCUMENT READ] Processing completed in {duration:.2f}s")
        logger.info(f"[DOCUMENT READ] Returning processed content: {len(processed_content)} characters")
        logger.info("=" * 80)
        
        return DocumentReadResponse(
            pageId=request.pageId,
            title=request.title,
            content=processed_content,
            format=request.format,
            metadata=request.metadata,
            success=True
        )
    except Exception as e:
        error_msg = str(e)
        duration = (datetime.now() - start_time).total_seconds()
        logger.error("=" * 80)
        logger.error(f"[DOCUMENT READ ERROR] Error after {duration:.2f}s")
        logger.error(f"[DOCUMENT READ ERROR] Error type: {type(e).__name__}")
        logger.error(f"[DOCUMENT READ ERROR] Error message: {error_msg}")
        import traceback
        logger.error(f"[DOCUMENT READ ERROR] Traceback:\n{traceback.format_exc()}")
        logger.error("=" * 80)
        raise HTTPException(status_code=500, detail=f"Error processing document: {error_msg}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

