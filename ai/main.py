from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
import google.generativeai as genai

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
    allow_headers=["Content-Type", "X-API-Key", "X-Workspace-Id", "X-User-Id"],
    expose_headers=["Content-Type"],
)

# Configuration
API_KEY = os.getenv("API_KEY", "parth128")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Chat history storage directory
CHAT_HISTORY_DIR = Path(__file__).parent / "chat_history"
CHAT_HISTORY_DIR.mkdir(exist_ok=True)

# Debug: Print if API key is loaded (without showing the actual key)
print(f"API_KEY loaded: {'Yes' if API_KEY else 'No'}")
print(f"GEMINI_API_KEY loaded: {'Yes' if GEMINI_API_KEY and GEMINI_API_KEY != 'your-gemini-api-key-here' else 'No'}")

if not GEMINI_API_KEY or GEMINI_API_KEY == "your-gemini-api-key-here":
    raise ValueError(
        "GEMINI_API_KEY environment variable is required. "
        "Please set it in the .env file. Get your key from: https://makersuite.google.com/app/apikey"
    )

# Initialize Gemini
try:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.5-flash")
    print("Gemini model initialized successfully")
except Exception as e:
    print(f"Error initializing Gemini: {e}")
    raise

# Request/Response models
class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]

class ChatResponse(BaseModel):
    message: str
    success: bool = True
    chatId: Optional[str] = None

class ChatHistoryItem(BaseModel):
    id: str
    title: str
    createdAt: str
    messageCount: int

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
    x_user_id: Optional[str] = Header(None)
):
    try:
        # Build conversation history from previous messages (excluding the last user message)
        history = []
        for msg in request.messages[:-1]:  # Exclude last message
            if msg.role == "user":
                history.append({"role": "user", "parts": [msg.content]})
            elif msg.role == "assistant":
                history.append({"role": "model", "parts": [msg.content]})
        
        # Get the last user message
        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from user")
        
        # Start a chat session with history
        chat_session = model.start_chat(history=history)
        
        # Send the last user message and get response
        response = chat_session.send_message(last_message.content)
        
        # Add assistant response to messages
        all_messages = request.messages + [Message(role="assistant", content=response.text)]
        
        # Generate or use existing chat ID (could be passed from frontend)
        chat_id = str(uuid.uuid4())
        
        # Save chat history if workspace and user IDs are provided
        if x_workspace_id and x_user_id:
            save_chat_history(chat_id, all_messages, x_workspace_id, x_user_id)
        
        return ChatResponse(
            message=response.text,
            success=True,
            chatId=chat_id
        )
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        print(f"Error in chat endpoint: {error_msg}")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

