"""
Vector search tools for AI service

These tools allow the AI to perform semantic/vector search across documents
using the Cloud AI server's embedding search capabilities.
"""

import httpx
import os
import json
import logging
from typing import Dict, Any
from datetime import datetime
from .tool_registry import ToolRegistry, ToolDefinition

logger = logging.getLogger(__name__)

# Cloud AI Server URL - should match CLOUD_AI_URL in backend .env
CLOUD_AI_URL = os.getenv("CLOUD_AI_URL", "http://localhost:3001")
# API Key for authenticating with Cloud AI server (same as backend)
CLOUD_AI_API_KEY = os.getenv("EXTERNAL_SERVICE_API_KEY", "parth128")
# Timeout for Cloud AI API requests (in seconds)
CLOUD_AI_API_TIMEOUT = float(os.getenv("CLOUD_AI_API_TIMEOUT", "30.0"))  # 30 seconds default


def vector_search_handler(arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handler for vector_search tool
    
    Performs semantic/vector search across documents in the workspace to find
    relevant content based on a query. Uses embedding similarity search.
    
    If pageId is provided (from context or arguments), searches only within that page's chunks.
    If pageId is not provided, searches across the entire workspace.
    
    Arguments:
        - query: The search query/message (required)
        - limit: Number of results to return (optional, default: 10, min: 1, max: 100)
        - threshold: Similarity threshold (optional, default: 0.7, min: 0, max: 1)
                     Lower threshold = stricter matching (fewer results)
        - pageId: Optional page ID to search within a specific page only (if not provided, searches entire workspace)
    
    Context (automatically provided):
        - workspaceId: Current workspace ID
        - userId: Current user ID
        - pageId: Current page ID (if available, used if not provided in arguments)
    """
    start_time = datetime.now()
    logger.info("-" * 80)
    logger.info("[TOOL: vector_search] Starting vector search operation")
    
    try:
        args_str = json.dumps(arguments, indent=2, default=str)
        logger.info(f"[TOOL: vector_search] Arguments: {args_str}")
    except (TypeError, ValueError):
        logger.info(f"[TOOL: vector_search] Arguments: {str(arguments)}")
    logger.info(f"[TOOL: vector_search] Context: workspace={context.get('workspaceId')}, user={context.get('userId')}, page={context.get('pageId')}")
    
    # Get query from arguments
    query = arguments.get("query")
    if not query:
        error_msg = "query is required"
        logger.error(f"[TOOL: vector_search] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Get context values first
    workspace_id = context.get("workspaceId")
    user_id = context.get("userId")
    context_page_id = context.get("pageId")
    
    # Log context information for debugging
    logger.info(f"[TOOL: vector_search] Context - WorkspaceId: {workspace_id}, UserId: {user_id}, ContextPageId: {context_page_id}")
    
    if not workspace_id:
        error_msg = "Workspace ID is required in context"
        logger.error(f"[TOOL: vector_search] ERROR: {error_msg}")
        return {"error": error_msg}
    
    # Get pageId from arguments or context (prefer arguments if provided)
    page_id = arguments.get("pageId") or context_page_id
    
    # Get optional parameters
    limit = arguments.get("limit", 10)
    threshold = arguments.get("threshold", 0.7)
    
    # Validate limit
    if not isinstance(limit, (int, float)) or limit < 1 or limit > 100:
        logger.warning(f"[TOOL: vector_search] Invalid limit {limit}, using default 10")
        limit = 10
    limit = int(limit)
    
    # Validate threshold
    if not isinstance(threshold, (int, float)) or threshold < 0 or threshold > 1:
        logger.warning(f"[TOOL: vector_search] Invalid threshold {threshold}, using default 0.7")
        threshold = 0.7
    threshold = float(threshold)
    
    logger.info(f"[TOOL: vector_search] Query: '{query}'")
    logger.info(f"[TOOL: vector_search] Limit: {limit}, Threshold: {threshold}")
    
    # Determine final pageId and log search scope
    if page_id:
        if arguments.get("pageId"):
            logger.info(f"[TOOL: vector_search] Using pageId from arguments: {page_id} (searching within this page only)")
        else:
            logger.info(f"[TOOL: vector_search] Using pageId from context: {page_id} (searching within this page only)")
    else:
        logger.info(f"[TOOL: vector_search] No pageId provided (searching entire workspace)")
    
    # Call Cloud AI server vector search endpoint
    try:
        url = f"{CLOUD_AI_URL}/embeddings/search"
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": CLOUD_AI_API_KEY,
            "X-Workspace-Id": workspace_id,
        }
        
        # Add optional context headers
        if user_id:
            headers["X-User-Id"] = user_id
        
        # Add pageId to header if available (for tracking)
        if page_id:
            headers["X-Page-Id"] = page_id
        
        payload = {
            "query": query,
            "limit": limit,
            "threshold": threshold,
        }
        
        # Add pageId to payload if provided
        if page_id:
            payload["pageId"] = page_id
        
        logger.info(f"[TOOL: vector_search] Calling Cloud AI server: {url}")
        logger.info(f"[TOOL: vector_search] Request payload: {json.dumps(payload, indent=2)}")
        logger.info(f"[TOOL: vector_search] Request timeout: {CLOUD_AI_API_TIMEOUT}s")
        
        request_start = datetime.now()
        timeout = httpx.Timeout(connect=10.0, read=CLOUD_AI_API_TIMEOUT, write=10.0, pool=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload, headers=headers)
            request_duration = (datetime.now() - request_start).total_seconds()
            
            logger.info(f"[TOOL: vector_search] Cloud AI server response status: {response.status_code}")
            logger.info(f"[TOOL: vector_search] Cloud AI server request duration: {request_duration:.2f}s")
            
            response.raise_for_status()
            response_data = response.json()
            
            # Log the response for debugging
            logger.info(f"[TOOL: vector_search] Response keys: {list(response_data.keys()) if isinstance(response_data, dict) else 'Not a dict'}")
            
            # Extract results
            results = response_data.get("results", [])
            count = response_data.get("count", len(results))
            
            logger.info(f"[TOOL: vector_search] Found {count} results")
            
            # Format results for AI consumption
            formatted_results = []
            for result in results:
                formatted_result = {
                    "pageId": result.get("pageId"),
                    "chunkIndex": result.get("chunkIndex"),
                    "content": result.get("content", ""),
                    "distance": result.get("distance"),
                    "relevance": 1.0 - result.get("distance", 1.0),  # Convert distance to relevance score
                }
                
                # Include metadata if available
                if result.get("metadata"):
                    formatted_result["metadata"] = result.get("metadata")
                
                formatted_results.append(formatted_result)
            
            total_duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TOOL: vector_search] Operation completed in {total_duration:.2f}s")
            logger.info("-" * 80)
            
            return {
                "success": True,
                "query": query,
                "pageId": page_id,  # Include pageId in response to show search scope
                "results": formatted_results,
                "count": count,
                "limit": limit,
                "threshold": threshold,
            }
    except httpx.HTTPStatusError as e:
        error_msg = f"Cloud AI server error: {e.response.status_code} - {e.response.text}"
        logger.error(f"[TOOL: vector_search] HTTP ERROR: {error_msg}")
        logger.error(f"[TOOL: vector_search] Response headers: {dict(e.response.headers)}")
        return {"error": error_msg}
    except httpx.TimeoutException as e:
        error_msg = f"Cloud AI server timeout: {str(e)}"
        logger.error(f"[TOOL: vector_search] TIMEOUT ERROR: {error_msg}")
        return {"error": error_msg}
    except Exception as e:
        error_msg = f"Error calling Cloud AI server: {str(e)}"
        logger.error(f"[TOOL: vector_search] EXCEPTION: {error_msg}")
        import traceback
        logger.error(f"[TOOL: vector_search] Traceback:\n{traceback.format_exc()}")
        return {"error": error_msg}


# Register vector search tools
def register_vector_search_tools(registry: ToolRegistry):
    """Register all vector search-related tools"""
    
    vector_search_tool = ToolDefinition(
        name="vector_search",
        description="Search for relevant documents and content using semantic/vector similarity search. This tool finds documents that are semantically similar to your query, even if they don't contain the exact keywords. Use this when you need to find related information, similar concepts, or content that matches the meaning of your query. Returns chunks of content from documents ranked by relevance. If pageId is provided, searches only within that specific page. If pageId is not provided, searches across the entire workspace.",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query or message to find semantically similar content. This can be a question, a topic, or any text describing what you're looking for."
                },
                "limit": {
                    "type": "number",
                    "description": "Number of results to return. Defaults to 10 if not specified. Minimum: 1, Maximum: 100.",
                    "minimum": 1,
                    "maximum": 100
                },
                "threshold": {
                    "type": "number",
                    "description": "Similarity threshold (0-1). Lower values mean stricter matching (fewer results). Defaults to 0.7 if not specified. 0.0 = only exact matches, 1.0 = all content. Recommended: 0.6-0.8 for balanced results.",
                    "minimum": 0,
                    "maximum": 1
                },
                "pageId": {
                    "type": "string",
                    "description": "Optional UUID of a specific page to search within. If provided, searches only within that page's chunks. If not provided, searches across the entire workspace. If you're working with a specific document and want to find related content within it, provide the pageId."
                }
            },
            "required": ["query"]
        },
        handler=vector_search_handler
    )
    
    registry.register(vector_search_tool)

