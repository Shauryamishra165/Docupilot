"""
Tool Registry for AI Service

This module defines available tools that the AI can use to interact with the Docmost backend.
Tools are registered here and can be called by the AI using function calling.
"""

from typing import Dict, Any, Callable, Optional
from dataclasses import dataclass
import json
import logging

logger = logging.getLogger(__name__)


@dataclass
class ToolDefinition:
    """Definition of an available tool"""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema for parameters
    handler: Callable  # Function that executes the tool


class ToolRegistry:
    """Registry for all available AI tools"""
    
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}
    
    def register(self, tool: ToolDefinition):
        """Register a tool"""
        self._tools[tool.name] = tool
    
    def get_tool(self, name: str) -> Optional[ToolDefinition]:
        """Get a tool by name"""
        return self._tools.get(name)
    
    def _clean_schema(self, schema: Any) -> Any:
        """Recursively remove 'default' fields from schema (Gemini doesn't support them)"""
        if isinstance(schema, dict):
            # Create a new dict without 'default' key
            cleaned = {k: self._clean_schema(v) for k, v in schema.items() if k != "default"}
            return cleaned
        elif isinstance(schema, list):
            return [self._clean_schema(item) for item in schema]
        else:
            return schema
    
    def list_tools(self) -> list[Dict[str, Any]]:
        """Get list of all tools in Gemini function calling format"""
        if not self._tools:
            return []
        
        # Gemini expects tools as a list of function declarations
        function_declarations = [
            {
                "name": tool.name,
                "description": tool.description,
                "parameters": self._clean_schema(tool.parameters)  # Clean schema before sending
            }
            for tool in self._tools.values()
        ]
        
        return [{"function_declarations": function_declarations}]
    
    def execute_tool(self, name: str, arguments: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool with given arguments and context"""
        logger.info(f"[TOOL REGISTRY] Executing tool: {name}")
        # Safely serialize arguments (may contain non-JSON types like MapComposite from Gemini)
        try:
            args_str = json.dumps(arguments, indent=2, default=str)
            logger.info(f"[TOOL REGISTRY] Arguments: {args_str}")
        except (TypeError, ValueError) as e:
            logger.info(f"[TOOL REGISTRY] Arguments: {str(arguments)} (could not serialize as JSON: {e})")
        
        tool = self.get_tool(name)
        if not tool:
            error_msg = f"Tool '{name}' not found"
            logger.error(f"[TOOL REGISTRY] {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }
        
        try:
            logger.info(f"[TOOL REGISTRY] Calling tool handler for: {name}")
            result = tool.handler(arguments, context)
            logger.info(f"[TOOL REGISTRY] Tool '{name}' executed successfully")
            return {
                "success": True,
                "result": result
            }
        except Exception as e:
            error_msg = str(e)
            logger.error(f"[TOOL REGISTRY] Tool '{name}' execution failed: {error_msg}")
            import traceback
            logger.error(f"[TOOL REGISTRY] Traceback:\n{traceback.format_exc()}")
            return {
                "success": False,
                "error": error_msg
            }


# Global tool registry instance
tool_registry = ToolRegistry()

