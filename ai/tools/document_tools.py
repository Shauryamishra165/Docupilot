"""
Document-related tools for AI service

These tools allow the AI to interact with documents in the Docmost backend.
"""

import httpx
import os
import json
import logging
from typing import Dict, Any
from datetime import datetime
from .tool_registry import ToolRegistry, ToolDefinition

logger = logging.getLogger(__name__)

# Backend URL - should match EXTERNAL_SERVICE_URL in backend .env
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
# Internal API endpoint for service-to-service communication
BACKEND_INTERNAL_URL = os.getenv("BACKEND_INTERNAL_URL", BACKEND_URL)
# API Key for authenticating with backend internal endpoints
BACKEND_API_KEY = os.getenv("EXTERNAL_SERVICE_API_KEY", "parth128")
# Timeout for backend API requests (in seconds) - increased for large documents
BACKEND_API_TIMEOUT = float(os.getenv("BACKEND_API_TIMEOUT", "120.0"))  # 2 minutes default


def detect_content_type(content: Any, provided_type: str = None) -> str:
    """
    Auto-detect content type if not provided.
    ALWAYS defaults to 'text' for plain strings (AI-friendly format).
    Only uses JSON/HTML if content is clearly structured (dict, valid JSON, HTML tags).
    Ignores incorrect contentType from AI if content is clearly plain text.
    
    Args:
        content: The content to analyze
        provided_type: Content type if explicitly provided (may be overridden)
    
    Returns:
        Detected content type: 'json', 'html', 'markdown', or 'text'
    """
    # If content is a dict/object, it's JSON (regardless of provided_type)
    if isinstance(content, dict):
        return "json"
    
    # If content is a string, analyze it
    if isinstance(content, str):
        content_stripped = content.strip()
        
        # Empty string defaults to text
        if not content_stripped:
            return "text"
        
        # Check if it's valid JSON (must start with { or [ and be parseable)
        if content_stripped.startswith("{") or content_stripped.startswith("["):
            try:
                parsed = json.loads(content_stripped)
                # Only return JSON if it's actually a valid JSON structure
                if isinstance(parsed, (dict, list)):
                    return "json"
            except (json.JSONDecodeError, TypeError, ValueError):
                # Not valid JSON - AI might have said "json" but it's not, use text
                return "text"
        
        # Check if it's HTML (must start with < and have >, and contain HTML tags)
        if content_stripped.startswith("<") and ">" in content_stripped:
            html_tags = ["<html", "<div", "<p", "<h1", "<h2", "<h3", "<span", "<body", "<head", "<br", "<img", "<a "]
            content_lower = content_stripped.lower()
            if any(tag in content_lower for tag in html_tags):
                return "html"
        
        # Check if it's Markdown (has markdown syntax in first 200 chars)
        markdown_indicators = ["# ", "## ", "### ", "#### ", "**", "* ", "- ", "```", "> ", "---", "==="]
        preview = content_stripped[:200]
        if any(indicator in preview for indicator in markdown_indicators):
            return "markdown"
        
        # Default to text for all plain strings (AI-friendly)
        # Even if AI said "json", if it's not valid JSON, use text
        return "text"
    
    # Default to text for unknown types (AI-friendly)
    return "text"


def read_document_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for read_document tool
    
    Calls the backend API to read a document/page.
    
    Arguments:
        - pageId (optional): UUID of the page to read. If not provided, uses current page from context.
        - format (optional): Output format - 'text' or 'markdown' only (default: 'text')
        - includeMetadata (optional): Include page metadata (default: False)
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available)
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: read_document] Starting document read operation")
    # Safely serialize arguments (may contain non-JSON types)
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: read_document] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: read_document] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: read_document] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
    
    # Get pageId from arguments or context
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required. Either provide it as an argument or ensure it's in the request context."
        logger.error(f"[TOOL: read_document] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Force text or markdown format only (no JSON or HTML)
    format_type = arguments.get("format", "text")
    if format_type not in ["text", "markdown"]:
        logger.warning(f"[TOOL: read_document] Format '{format_type}' not supported, defaulting to 'text'")
        format_type = "text"
    
    include_metadata = arguments.get("includeMetadata", False)
    
    logger.info(f"[TOOL: read_document] Using pageId: {page_id}")
    logger.info(f"[TOOL: read_document] Format: {format_type} (text/markdown only), Include metadata: {include_metadata}")
    
    # Get context values
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: read_document] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Call backend internal API (service-to-service communication)
    # Uses API key authentication instead of JWT
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/read"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {
            "pageId": page_id,
            "format": format_type,
            "includeMetadata": include_metadata
        }
        
        logger.info(f"[TOOL: read_document] Calling backend API: {url}")
        logger.info(f"[TOOL: read_document] Request payload: {json.dumps(payload, indent=2)}")
        logger.info(f"[TOOL: read_document] Request timeout: {BACKEND_API_TIMEOUT}s")
        
        request_start = datetime.now()
        # Use separate timeouts: 10s for connection, BACKEND_API_TIMEOUT for read (allows large document processing)
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: read_document] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: read_document] Backend API request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            # Log the raw response for debugging
            logger.info(f"[TOOL: read_document] Backend response keys: {list(response_wrapper.keys()) if isinstance(response_wrapper, dict) else 'Not a dict'}")
            logger.info(f"[TOOL: read_document] Backend response preview: {str(response_wrapper)[:500]}...")
            
            # Backend wraps response in { data, success, status } via TransformHttpResponseInterceptor
            # Unwrap the data field
            result = response_wrapper.get("data", response_wrapper)
            if not isinstance(result, dict):
                result = {}
            
            # Extract content and ensure it's a string (text or markdown)
            content = result.get("content", "")
            if not isinstance(content, str):
                # If content is not a string, convert it
                content = str(content)
                logger.warning(f"[TOOL: read_document] Content was not a string, converted to string")
            
            content_length = len(content)
            logger.info(f"[TOOL: read_document] Document content retrieved: {content_length} characters")
            logger.info(f"[TOOL: read_document] Document title: {result.get('title', 'N/A')}")
            if result.get("metadata"):
                logger.info(f"[TOOL: read_document] Metadata: wordCount={result.get('metadata', {}).get('wordCount', 'N/A')}, charCount={result.get('metadata', {}).get('characterCount', 'N/A')}")
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: read_document] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            # Return simplified response with only text/markdown content
            response_data = {
                "pageId": result.get("pageId"),
                "title": result.get("title"),
                "content": content,  # Always text or markdown string
                "format": format_type,  # Use the format we requested
                "success": result.get("success", True)
            }
            
            # Only include metadata if requested and it's a simple dict
            if include_metadata and result.get("metadata"):
                metadata = result.get("metadata")
                if isinstance(metadata, dict):
                    response_data["metadata"] = metadata
            
            return response_data
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: read_document] HTTP ERROR: {error_msg}")
        logger.error(f"[TOOL: read_document] Response headers: {dict(e.response.headers)}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: read_document] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: read_document] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: read_document] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def replace_document_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for replace_document tool
    
    Replaces the entire content of a document/page.
    
    Arguments:
        - pageId (optional): UUID of the page to replace. If not provided, uses current page from context.
        - content: The new content to replace the entire document (string or JSON)
        - contentType (optional): Format of the content - 'json', 'html', 'markdown', or 'text' (default: 'json')
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available)
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: replace_document] Starting document replace operation")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: replace_document] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: replace_document] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: replace_document] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
    
    # Get pageId from arguments or context
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required. Either provide it as an argument or ensure it's in the request context."
        logger.error(f"[TOOL: replace_document] ERROR: {error_msg}")
        return {"error": error_msg}
    
    content = arguments.get("content")
    if not content:
        error_msg = "content is required"
        logger.error(f"[TOOL: replace_document] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Auto-detect content type if not provided
    # Default to "text" for AI-friendly content (plain strings)
    provided_content_type = arguments.get("contentType")
    content_type = detect_content_type(content, provided_content_type)
    
    logger.info(f"[TOOL: replace_document] Content type provided: {provided_content_type}")
    logger.info(f"[TOOL: replace_document] Content type detected: {content_type}")
    logger.info(f"[TOOL: replace_document] Content preview: {str(content)[:100]}...")
    
    # Get context values
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: replace_document] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/replace"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {
            "pageId": page_id,
            "content": content,
            "contentType": content_type
        }
        
        logger.info(f"[TOOL: replace_document] Calling backend API: {url}")
        logger.info(f"[TOOL: replace_document] Request payload: {json.dumps(payload, indent=2, default=str)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: replace_document] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: replace_document] Backend API request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            # Unwrap the data field
            result = response_wrapper.get("data", response_wrapper)
            if not isinstance(result, dict):
                result = {}
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: replace_document] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "pageId": result.get("pageId"),
                "success": result.get("success", True),
                "message": result.get("message", "Document replaced successfully")
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: replace_document] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: replace_document] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: replace_document] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: replace_document] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def insert_content_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for insert_content tool
    
    Inserts content at a specified position in a document/page.
    
    Arguments:
        - pageId (optional): UUID of the page to insert into. If not provided, uses current page from context.
        - content: The content to insert (string or JSON)
        - contentType (optional): Format of the content - 'json', 'html', 'markdown', or 'text' (default: 'json')
        - position (optional): Where to insert - 'cursor', 'start', or 'end' (default: 'end')
        - positionOffset (optional): Character offset for cursor position (only used when position='cursor')
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available)
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: insert_content] Starting content insert operation")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: insert_content] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: insert_content] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: insert_content] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
    
    # Get pageId from arguments or context
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required. Either provide it as an argument or ensure it's in the request context."
        logger.error(f"[TOOL: insert_content] ERROR: {error_msg}")
        return {"error": error_msg}
    
    content = arguments.get("content")
    if not content:
        error_msg = "content is required"
        logger.error(f"[TOOL: insert_content] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Auto-detect content type if not provided
    # Default to "text" for AI-friendly content (plain strings)
    provided_content_type = arguments.get("contentType")
    content_type = detect_content_type(content, provided_content_type)
    
    logger.info(f"[TOOL: insert_content] Content type provided: {provided_content_type}")
    logger.info(f"[TOOL: insert_content] Content type detected: {content_type}")
    logger.info(f"[TOOL: insert_content] Content preview: {str(content)[:100]}...")
    
    position = arguments.get("position", "end")
    if position not in ["cursor", "start", "end"]:
        logger.warning(f"[TOOL: insert_content] Position '{position}' not supported, defaulting to 'end'")
        position = "end"
    
    position_offset = arguments.get("positionOffset")
    
    # Get context values
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: insert_content] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/insert"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {
            "pageId": page_id,
            "content": content,
            "contentType": content_type,
            "position": position
        }
        
        if position_offset is not None:
            payload["positionOffset"] = position_offset
        
        logger.info(f"[TOOL: insert_content] Calling backend API: {url}")
        logger.info(f"[TOOL: insert_content] Request payload: {json.dumps(payload, indent=2, default=str)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: insert_content] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: insert_content] Backend API request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            # Unwrap the data field
            result = response_wrapper.get("data", response_wrapper)
            if not isinstance(result, dict):
                result = {}
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: insert_content] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "pageId": result.get("pageId"),
                "success": result.get("success", True),
                "message": result.get("message", "Content inserted successfully"),
                "insertedAt": result.get("insertedAt")
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: insert_content] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: insert_content] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: insert_content] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: insert_content] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def replace_range_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for replace_range tool
    
    Replaces content in a specific range (from character position to character position) in a document/page.
    
    Arguments:
        - pageId (optional): UUID of the page to modify. If not provided, uses current page from context.
        - from: Start character position (required)
        - to: End character position (required, must be greater than 'from')
        - content: The new content to replace the range with (string or JSON)
        - contentType (optional): Format of the content - 'json', 'html', 'markdown', or 'text' (default: 'json')
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available)
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: replace_range] Starting range replace operation")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: replace_range] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: replace_range] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: replace_range] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
    
    # Get pageId from arguments or context
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required. Either provide it as an argument or ensure it's in the request context."
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    from_pos = arguments.get("from")
    to_pos = arguments.get("to")
    
    if from_pos is None or to_pos is None:
        error_msg = "Both 'from' and 'to' character positions are required"
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    if not isinstance(from_pos, (int, float)) or not isinstance(to_pos, (int, float)):
        error_msg = "'from' and 'to' must be numbers"
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    if from_pos >= to_pos:
        error_msg = "'from' must be less than 'to'"
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    content = arguments.get("content")
    if not content:
        error_msg = "content is required"
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Auto-detect content type if not provided
    # Default to "text" for AI-friendly content (plain strings)
    provided_content_type = arguments.get("contentType")
    content_type = detect_content_type(content, provided_content_type)
    
    logger.info(f"[TOOL: replace_range] Content type provided: {provided_content_type}")
    logger.info(f"[TOOL: replace_range] Content type detected: {content_type}")
    logger.info(f"[TOOL: replace_range] Content preview: {str(content)[:100]}...")
    
    # Get context values
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: replace_range] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/replace-range"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {
            "pageId": page_id,
            "from": int(from_pos),
            "to": int(to_pos),
            "content": content,
            "contentType": content_type
        }
        
        logger.info(f"[TOOL: replace_range] Calling backend API: {url}")
        logger.info(f"[TOOL: replace_range] Request payload: {json.dumps(payload, indent=2, default=str)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: replace_range] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: replace_range] Backend API request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            # Unwrap the data field
            result = response_wrapper.get("data", response_wrapper)
            if not isinstance(result, dict):
                result = {}
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: replace_range] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "pageId": result.get("pageId"),
                "success": result.get("success", True),
                "message": result.get("message", "Range replaced successfully"),
                "replacedFrom": result.get("replacedFrom"),
                "replacedTo": result.get("replacedTo")
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: replace_range] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: replace_range] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: replace_range] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: replace_range] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


# Register document reading tool
def register_document_tools(registry: ToolRegistry):
    """Register all document-related tools"""
    
    read_document_tool = ToolDefinition(
        name="read_document",
        description="Read the content of a document/page. Can read the current page or a specific page by ID. Returns the document content as plain text or markdown format only.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to read. If not provided, uses the current page from context."
                },
                "format": {
                    "type": "string",
                    "enum": ["text", "markdown"],
                    "description": "Output format for the document content. Only 'text' or 'markdown' are supported. Defaults to 'text' if not specified."
                },
                "includeMetadata": {
                    "type": "boolean",
                    "description": "Whether to include page metadata (word count, character count, creation date, etc.). Defaults to false if not specified."
                }
            }
        },
        handler=read_document_handler
    )
    
    replace_document_tool = ToolDefinition(
        name="replace_document",
        description="Replace the entire content of a document/page. This completely replaces all existing content with new content. Use this for full document rewrites, regeneration, or 'make this better' operations.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to replace. If not provided, uses the current page from context."
                },
                "content": {
                    "type": "string",
                    "description": "The new content to replace the entire document. Can be JSON (ProseMirror format), HTML, Markdown, or plain text string."
                },
                "contentType": {
                    "type": "string",
                    "enum": ["json", "html", "markdown", "text"],
                    "description": "Format of the content being provided. 'json' for ProseMirror JSON, 'html' for HTML, 'markdown' for Markdown, or 'text' for plain text. Defaults to 'json' if not specified."
                }
            },
            "required": ["content"]
        },
        handler=replace_document_handler
    )
    
    insert_content_tool = ToolDefinition(
        name="insert_content",
        description="Insert content at a specified position in a document/page. Use this to add new content without replacing existing content.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to insert into. If not provided, uses the current page from context."
                },
                "content": {
                    "type": "string",
                    "description": "The content to insert. Can be JSON (ProseMirror format), HTML, Markdown, or plain text string."
                },
                "contentType": {
                    "type": "string",
                    "enum": ["json", "html", "markdown", "text"],
                    "description": "Format of the content being provided. 'json' for ProseMirror JSON, 'html' for HTML, 'markdown' for Markdown, or 'text' for plain text. Defaults to 'json' if not specified."
                },
                "position": {
                    "type": "string",
                    "enum": ["cursor", "start", "end"],
                    "description": "Where to insert the content. 'start' inserts at the beginning, 'end' inserts at the end, 'cursor' inserts at a specific character position (requires positionOffset). Defaults to 'end' if not specified."
                },
                "positionOffset": {
                    "type": "number",
                    "description": "Character offset for cursor position. Only used when position='cursor'. If not provided with position='cursor', content is inserted at the end."
                }
            },
            "required": ["content"]
        },
        handler=insert_content_handler
    )
    
    replace_range_tool = ToolDefinition(
        name="replace_range",
        description="Replace content in a specific character range (from position to position) in a document/page. This is critical for AI operations like editing selected paragraphs, rewriting sections, fixing sentences, or modifying specific parts of the document.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to modify. If not provided, uses the current page from context."
                },
                "from": {
                    "type": "number",
                    "description": "Start character position (0-based). Must be less than 'to'."
                },
                "to": {
                    "type": "number",
                    "description": "End character position (0-based). Must be greater than 'from'."
                },
                "content": {
                    "type": "string",
                    "description": "The new content to replace the range with. Can be JSON (ProseMirror format), HTML, Markdown, or plain text string."
                },
                "contentType": {
                    "type": "string",
                    "enum": ["json", "html", "markdown", "text"],
                    "description": "Format of the content being provided. 'json' for ProseMirror JSON, 'html' for HTML, 'markdown' for Markdown, or 'text' for plain text. Defaults to 'json' if not specified."
                }
            },
            "required": ["from", "to", "content"]
        },
        handler=replace_range_handler
    )
    
    registry.register(read_document_tool)
    registry.register(replace_document_tool)
    registry.register(insert_content_tool)
    registry.register(replace_range_tool)

