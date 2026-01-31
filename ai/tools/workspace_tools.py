"""
Workspace awareness tools for AI service

These tools allow the AI to understand the workspace structure,
list pages, get page metadata, and navigate the document hierarchy.
"""

import httpx
import os
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from .tool_registry import ToolRegistry, ToolDefinition

logger = logging.getLogger(__name__)

# Backend URL - should match EXTERNAL_SERVICE_URL in backend .env
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
BACKEND_INTERNAL_URL = os.getenv("BACKEND_INTERNAL_URL", BACKEND_URL)
BACKEND_API_KEY = os.getenv("EXTERNAL_SERVICE_API_KEY", "parth128")
BACKEND_API_TIMEOUT = float(os.getenv("BACKEND_API_TIMEOUT", "60.0"))


def list_workspace_pages_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for list_workspace_pages tool
    
    Lists all pages in a workspace/space to understand document structure.
    
    Arguments:
        - spaceId (optional): UUID of the space to list pages from
        - pageId (optional): UUID of a parent page to list children
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: list_workspace_pages] Starting workspace pages listing")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: list_workspace_pages] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: list_workspace_pages] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: list_workspace_pages] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}")
    
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: list_workspace_pages] ERROR: {error_msg}")
        return {"error": error_msg}
    
    space_id = arguments.get("spaceId")
    page_id = arguments.get("pageId")
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/workspace/pages"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {}
        if space_id:
            payload["spaceId"] = space_id
        if page_id:
            payload["pageId"] = page_id
        
        logger.info(f"[TOOL: list_workspace_pages] Calling backend API: {url}")
        logger.info(f"[TOOL: list_workspace_pages] Request payload: {json.dumps(payload, indent=2)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: list_workspace_pages] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: list_workspace_pages] Request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            # Unwrap the data field
            result = response_wrapper.get("data", response_wrapper)
            
            pages = result.get("pages", [])
            spaces = result.get("spaces", [])
            
            logger.info(f"[TOOL: list_workspace_pages] Found {len(pages)} pages in {len(spaces)} spaces")
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: list_workspace_pages] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "success": True,
                "spaces": spaces,
                "pages": pages,
                "totalPages": len(pages),
                "totalSpaces": len(spaces)
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: list_workspace_pages] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: list_workspace_pages] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: list_workspace_pages] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: list_workspace_pages] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def get_page_structure_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for get_page_structure tool
    
    Gets the structural outline of a page including headings, sections, and hierarchy.
    
    Arguments:
        - pageId: UUID of the page to analyze (required)
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: get_page_structure] Starting page structure analysis")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: get_page_structure] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: get_page_structure] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: get_page_structure] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}")
    
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required"
        logger.error(f"[TOOL: get_page_structure] ERROR: {error_msg}")
        return {"error": error_msg}
    
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: get_page_structure] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/structure"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {"pageId": page_id}
        
        logger.info(f"[TOOL: get_page_structure] Calling backend API: {url}")
        logger.info(f"[TOOL: get_page_structure] Request payload: {json.dumps(payload, indent=2)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: get_page_structure] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: get_page_structure] Request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            result = response_wrapper.get("data", response_wrapper)
            
            headings = result.get("headings", [])
            logger.info(f"[TOOL: get_page_structure] Found {len(headings)} headings")
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: get_page_structure] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "success": True,
                "pageId": result.get("pageId"),
                "title": result.get("title"),
                "headings": headings,
                "sections": result.get("sections", []),
                "wordCount": result.get("wordCount"),
                "characterCount": result.get("characterCount")
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: get_page_structure] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: get_page_structure] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: get_page_structure] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: get_page_structure] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def get_page_metadata_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for get_page_metadata tool
    
    Gets detailed metadata about a page without full content.
    
    Arguments:
        - pageId: UUID of the page (required)
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: get_page_metadata] Starting page metadata retrieval")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: get_page_metadata] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: get_page_metadata] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: get_page_metadata] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}")
    
    page_id = arguments.get("pageId") or context.get("pageId")
    if not page_id:
        error_msg = "pageId is required"
        logger.error(f"[TOOL: get_page_metadata] ERROR: {error_msg}")
        return {"error": error_msg}
    
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id or not user_id:
        error_msg = "Workspace ID and User ID are required in context"
        logger.error(f"[TOOL: get_page_metadata] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/document/metadata"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {"pageId": page_id}
        
        logger.info(f"[TOOL: get_page_metadata] Calling backend API: {url}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: get_page_metadata] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: get_page_metadata] Request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            result = response_wrapper.get("data", response_wrapper)
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: get_page_metadata] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "success": True,
                "pageId": result.get("pageId"),
                "title": result.get("title"),
                "icon": result.get("icon"),
                "spaceId": result.get("spaceId"),
                "spaceName": result.get("spaceName"),
                "parentPageId": result.get("parentPageId"),
                "createdAt": result.get("createdAt"),
                "updatedAt": result.get("updatedAt"),
                "creatorName": result.get("creatorName"),
                "lastEditorName": result.get("lastEditorName"),
                "wordCount": result.get("wordCount"),
                "characterCount": result.get("characterCount")
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: get_page_metadata] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: get_page_metadata] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: get_page_metadata] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: get_page_metadata] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


def search_workspace_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for search_workspace tool
    
    Searches for pages by title or content across the workspace.
    Uses both title matching and vector search for comprehensive results.
    
    Arguments:
        - query: Search query (required)
        - searchType: 'title', 'content', or 'all' (default: 'all')
        - limit: Maximum results (default: 10)
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: search_workspace] Starting workspace search")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: search_workspace] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: search_workspace] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: search_workspace] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}")
    
    query = arguments.get("query")
    if not query:
        error_msg = "query is required"
        logger.error(f"[TOOL: search_workspace] ERROR: {error_msg}")
        return {"error": error_msg}
    
    search_type = arguments.get("searchType", "all")
    limit = arguments.get("limit", 10)
    
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    
    if not workspace_id:
        error_msg = "Workspace ID is required in context"
        logger.error(f"[TOOL: search_workspace] ERROR: {error_msg}")
        return {"error": error_msg}
    
    try:
        url = f"{BACKEND_INTERNAL_URL}/api/internal/ai/workspace/search"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": BACKEND_API_KEY,
            "X-Workspace-Id": workspace_id,
            "X-User-Id": user_id,
        }
        
        payload = {
            "query": query,
            "searchType": search_type,
            "limit": limit
        }
        
        logger.info(f"[TOOL: search_workspace] Calling backend API: {url}")
        logger.info(f"[TOOL: search_workspace] Request payload: {json.dumps(payload, indent=2)}")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=BACKEND_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: search_workspace] Backend API response status: {response.status_code}")
            logger.info(f"[TOOL: search_workspace] Request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_wrapper = response.json()
            
            result = response_wrapper.get("data", response_wrapper)
            
            results = result.get("results", [])
            logger.info(f"[TOOL: search_workspace] Found {len(results)} results")
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: search_workspace] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "success": True,
                "query": query,
                "searchType": search_type,
                "results": results,
                "totalResults": len(results)
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Backend API error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: search_workspace] HTTP ERROR: {error_msg}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Backend API timeout: {str(e)}"
        logger.error(f"[TOOL: search_workspace] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling backend API: {str(e)}"
        logger.error(f"[TOOL: search_workspace] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: search_workspace] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


# Register workspace tools
def register_workspace_tools(registry: ToolRegistry):
    """Register all workspace-related tools"""
    
    list_workspace_pages_tool = ToolDefinition(
        name="list_workspace_pages",
        description="List all pages in the workspace or a specific space. Returns page hierarchy with titles, IDs, icons, and relationships. Use this to understand what documents exist before making changes.",
        parameters={
            "type": "object",
            "properties": {
                "spaceId": {
                    "type": "string",
                    "description": "Optional UUID of a specific space to list pages from. If not provided, lists pages from all spaces."
                },
                "pageId": {
                    "type": "string",
                    "description": "Optional UUID of a parent page to list its children only."
                }
            }
        },
        handler=list_workspace_pages_handler
    )
    
    get_page_structure_tool = ToolDefinition(
        name="get_page_structure",
        description="Get the structural outline of a page including all headings (H1-H6), sections, and their positions. Use this to understand page organization before making targeted edits.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to analyze. If not provided, uses the current page from context."
                }
            }
        },
        handler=get_page_structure_handler
    )
    
    get_page_metadata_tool = ToolDefinition(
        name="get_page_metadata",
        description="Get detailed metadata about a page without the full content. Includes title, space info, dates, creator, word count, etc. Use this for quick page info lookup.",
        parameters={
            "type": "object",
            "properties": {
                "pageId": {
                    "type": "string",
                    "description": "UUID of the page to get metadata for. If not provided, uses the current page from context."
                }
            }
        },
        handler=get_page_metadata_handler
    )
    
    search_workspace_tool = ToolDefinition(
        name="search_workspace",
        description="Search for pages in the workspace by title or content. Returns matching pages with IDs and titles. Use this to find specific pages before reading or editing them.",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find pages by title or content."
                },
                "searchType": {
                    "type": "string",
                    "enum": ["title", "content", "all"],
                    "description": "Type of search: 'title' for title-only, 'content' for content-only, 'all' for both. Defaults to 'all'."
                },
                "limit": {
                    "type": "number",
                    "description": "Maximum number of results to return. Defaults to 10."
                }
            },
            "required": ["query"]
        },
        handler=search_workspace_handler
    )
    
    registry.register(list_workspace_pages_tool)
    registry.register(get_page_structure_tool)
    registry.register(get_page_metadata_tool)
    registry.register(search_workspace_tool)
