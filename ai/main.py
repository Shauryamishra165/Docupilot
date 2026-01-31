from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
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
from tools.vector_search_tools import register_vector_search_tools
from tools.workspace_tools import register_workspace_tools
from text_transform import create_text_transform_endpoint
from agents.document_agent import run_document_agent, get_document_agent

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
register_vector_search_tools(tool_registry)
register_workspace_tools(tool_registry)
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
    message: Optional[str] = None  # AI's text response (optional if toolCalls are present)
    success: bool = True
    chatId: Optional[str] = None
    toolCalls: Optional[List[Dict[str, Any]]] = None  # Tool calls to execute in frontend

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
    Chat endpoint - now uses LangGraph agent by default for intelligent, context-aware responses.
    
    This endpoint now delegates to the intelligent document agent which has:
    - Full workspace awareness
    - Semantic search capabilities
    - Proper tool execution with context
    
    Context is automatically passed from headers:
    - x_workspace_id: Current workspace ID
    - x_user_id: Current user ID
    - x_page_id: Current page ID (if available)
    
    The pageId can also be passed in the request body, which takes precedence over the header.
    """
    start_time = datetime.now()
    chat_id = str(uuid.uuid4())
    
    logger.info("=" * 80)
    logger.info(f"[CHAT] Using LangGraph agent (delegating to /api/agent/chat)")
    logger.info(f"[CHAT] Chat ID: {chat_id}")
    logger.info(f"[CHAT] Workspace: {x_workspace_id}, User: {x_user_id}, Page: {request.pageId or x_page_id}")
    
    try:
        # Validate request
        if not request.messages:
            raise HTTPException(status_code=400, detail="Messages are required")
        
        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from user")
        
        if not x_workspace_id:
            raise HTTPException(status_code=400, detail="X-Workspace-Id header is required")
        
        if not x_user_id:
            raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
        # Get page ID from request or header
        page_id = request.pageId or x_page_id
        
        # Build message history (excluding last message)
        message_history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.messages[:-1]
        ]
        
        logger.info(f"[CHAT] Query: {last_message.content[:100]}...")
        
        # Use the LangGraph agent for intelligent, context-aware responses
        result = await run_document_agent(
            query=last_message.content,
            workspace_id=x_workspace_id,
            user_id=x_user_id,
            page_id=page_id,
            message_history=message_history,
        )
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"[CHAT] Agent completed in {duration:.2f}s")
        logger.info(f"[CHAT] Success: {result.get('success', False)}")
        logger.info(f"[CHAT] Tool calls: {len(result.get('toolCalls') or [])}")
        logger.info("=" * 80)
        
        # Save chat history
        all_messages = request.messages + [Message(role="assistant", content=result.get("message", ""))]
        if x_workspace_id and x_user_id:
            save_chat_history(chat_id, all_messages, x_workspace_id, x_user_id)
        
        return ChatResponse(
            message=result.get("message"),
            success=result.get("success", True),
            chatId=chat_id,
            toolCalls=result.get("toolCalls"),
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

@app.post("/api/chat/stream", dependencies=[Depends(verify_api_key)])
async def chat_stream(
    request: ChatRequest,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_page_id: Optional[str] = Header(None)
):
    """
    Streaming chat endpoint - uses LangGraph agent with SSE streaming.
    
    Streams responses as Server-Sent Events (SSE) for real-time updates.
    Events include:
    - message: Text response chunks
    - tool_calls: Tool calls being made
    - tool_result: Tool execution results
    - pending_tools: Tool calls to execute on frontend
    - done: Stream completion
    - error: Error events
    """
    chat_id = str(uuid.uuid4())
    
    logger.info("=" * 80)
    logger.info(f"[CHAT STREAM] Starting streaming chat")
    logger.info(f"[CHAT STREAM] Chat ID: {chat_id}")
    logger.info(f"[CHAT STREAM] Workspace: {x_workspace_id}, User: {x_user_id}, Page: {request.pageId or x_page_id}")
    logger.info(f"[CHAT STREAM] Messages count: {len(request.messages)}")
    
    try:
        # Validate request
        if not request.messages:
            raise HTTPException(status_code=400, detail="Messages are required")
        
        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from user")
        
        if not x_workspace_id:
            raise HTTPException(status_code=400, detail="X-Workspace-Id header is required")
        
        if not x_user_id:
            raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
        # Get page ID from request or header
        page_id = request.pageId or x_page_id
        
        # Build message history (excluding last message)
        message_history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.messages[:-1]
        ]
        
        logger.info(f"[CHAT STREAM] Query: {last_message.content[:100]}...")
        
        # Create SSE streaming generator
        async def event_generator():
            event_count = 0
            try:
                agent = get_document_agent()
                
                logger.info("[CHAT STREAM] Starting agent stream...")
                
                # Stream events from agent
                async for event in agent.run_stream(
                    query=last_message.content,
                    workspace_id=x_workspace_id,
                    user_id=x_user_id,
                    page_id=page_id,
                    message_history=message_history,
                ):
                    event_count += 1
                    # Format as SSE event
                    event_type = event.get("type", "message")
                    data = json.dumps(event)
                    sse_message = f"event: {event_type}\ndata: {data}\n\n"
                    
                    logger.info(f"[CHAT STREAM] Yielding event #{event_count}: {event_type}")
                    
                    yield sse_message
                    
                    # Small delay to ensure proper SSE formatting
                    import asyncio
                    await asyncio.sleep(0.01)
                
                logger.info(f"[CHAT STREAM] Agent stream completed. Total events: {event_count}")
                
                # Send final done event
                done_event = f"event: done\ndata: {json.dumps({'chatId': chat_id})}\n\n"
                logger.info("[CHAT STREAM] Sending done event")
                yield done_event
                
            except Exception as e:
                logger.error(f"[CHAT STREAM] Error in generator: {str(e)}")
                import traceback
                logger.error(f"[CHAT STREAM] Traceback:\n{traceback.format_exc()}")
                error_event = json.dumps({"type": "error", "error": str(e)})
                yield f"event: error\ndata: {error_event}\n\n"
        
        logger.info("[CHAT STREAM] Returning StreamingResponse")
        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CHAT STREAM ERROR] {str(e)}")
        import traceback
        logger.error(f"[CHAT STREAM ERROR] Traceback:\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Stream error: {str(e)}")

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


# ============================================================================
# INTELLIGENT DOCUMENT AGENT ENDPOINT
# ============================================================================

class AgentChatRequest(BaseModel):
    """Request model for the intelligent agent chat endpoint."""
    messages: List[Message]
    pageId: Optional[str] = None  # Current page ID (optional, for context)
    useAgent: bool = True  # Whether to use the LangGraph agent (default: True)


class AgentChatResponse(BaseModel):
    """Response model for the intelligent agent chat endpoint."""
    message: Optional[str] = None
    success: bool = True
    chatId: Optional[str] = None
    toolCalls: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None


@app.post("/api/agent/chat", dependencies=[Depends(verify_api_key)])
async def agent_chat(
    request: AgentChatRequest,
    x_workspace_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_page_id: Optional[str] = Header(None),
):
    """
    Intelligent Document Agent Chat Endpoint
    
    This endpoint uses a LangGraph-based agent with full workspace awareness.
    The agent can:
    - List and navigate all pages in the workspace
    - Read document content and structure
    - Perform semantic search across documents
    - Make targeted edits while preserving formatting
    - Handle bulk operations like "change website name everywhere"
    
    The agent automatically decides which tools to use based on the user's request.
    
    Request headers:
    - X-API-Key: Authentication key
    - X-Workspace-Id: Current workspace ID
    - X-User-Id: Current user ID
    - X-Page-Id: Current page ID (optional)
    
    Request body:
    - messages: Conversation history
    - pageId: Current page ID (overrides header)
    - useAgent: Whether to use LangGraph agent (default: True)
    
    Response:
    - message: Agent's text response
    - toolCalls: Write operations to execute in frontend
    - metadata: Execution metadata (iterations, duration, etc.)
    """
    start_time = datetime.now()
    chat_id = str(uuid.uuid4())
    
    logger.info("=" * 80)
    logger.info("[AGENT ENDPOINT] Received agent chat request")
    logger.info(f"[AGENT ENDPOINT] Chat ID: {chat_id}")
    logger.info(f"[AGENT ENDPOINT] Workspace: {x_workspace_id}")
    logger.info(f"[AGENT ENDPOINT] User: {x_user_id}")
    logger.info(f"[AGENT ENDPOINT] Page: {request.pageId or x_page_id}")
    logger.info(f"[AGENT ENDPOINT] Message count: {len(request.messages)}")
    
    try:
        # Validate request
        if not request.messages:
            raise HTTPException(status_code=400, detail="Messages are required")
        
        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from user")
        
        if not x_workspace_id:
            raise HTTPException(status_code=400, detail="X-Workspace-Id header is required")
        
        if not x_user_id:
            raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
        # Get page ID from request or header
        page_id = request.pageId or x_page_id
        
        # Build message history (excluding last message)
        message_history = [
            {"role": msg.role, "content": msg.content}
            for msg in request.messages[:-1]
        ]
        
        logger.info(f"[AGENT ENDPOINT] Query: {last_message.content[:100]}..." if len(last_message.content) > 100 else f"[AGENT ENDPOINT] Query: {last_message.content}")
        
        # Run the document agent
        result = await run_document_agent(
            query=last_message.content,
            workspace_id=x_workspace_id,
            user_id=x_user_id,
            page_id=page_id,
            message_history=message_history,
        )
        
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"[AGENT ENDPOINT] Agent completed in {duration:.2f}s")
        logger.info(f"[AGENT ENDPOINT] Success: {result.get('success', False)}")
        logger.info(f"[AGENT ENDPOINT] Tool calls: {len(result.get('toolCalls') or [])}")
        logger.info("=" * 80)
        
        # Save chat history
        all_messages = request.messages + [Message(role="assistant", content=result.get("message", ""))]
        if x_workspace_id and x_user_id:
            save_chat_history(chat_id, all_messages, x_workspace_id, x_user_id)
        
        return AgentChatResponse(
            message=result.get("message"),
            success=result.get("success", True),
            chatId=chat_id,
            toolCalls=result.get("toolCalls"),
            metadata=result.get("metadata"),
        )
        
    except HTTPException:
        raise
    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds()
        logger.error("=" * 80)
        logger.error(f"[AGENT ENDPOINT ERROR] Chat ID: {chat_id}")
        logger.error(f"[AGENT ENDPOINT ERROR] Duration: {duration:.2f}s")
        logger.error(f"[AGENT ENDPOINT ERROR] Error: {str(e)}")
        import traceback
        logger.error(f"[AGENT ENDPOINT ERROR] Traceback:\n{traceback.format_exc()}")
        logger.error("=" * 80)
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


# Register text transform endpoint
create_text_transform_endpoint(app, model, verify_api_key)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

