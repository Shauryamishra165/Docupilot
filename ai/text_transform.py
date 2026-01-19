"""
Text Transform Module for AI Writing Assistance

This module handles text transformation commands like improve, fix-grammar, and change-tone.
It processes text with special bracket markers to identify the portion to be transformed.
"""

from fastapi import HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# Bracket markers for text transformation
TEXT_TRANSFORM_BRACKET_START = "[AI_SEL_START]"
TEXT_TRANSFORM_BRACKET_END = "[AI_SEL_END]"


# Text transform models for AI writing assistance
class TextTransformOptions(BaseModel):
    tone: Optional[str] = None  # 'formal', 'casual', 'professional', 'friendly'


class TextTransformRequest(BaseModel):
    command: str  # 'improve', 'fix-grammar', 'change-tone'
    blockTextWithBrackets: str  # Full block text with [AI_SEL_START] and [AI_SEL_END] markers
    selectedText: str  # The text between the brackets
    options: Optional[TextTransformOptions] = None


class TextTransformResponse(BaseModel):
    success: bool = True
    transformedBlockText: Optional[str] = None  # Full block with transformed text in brackets
    modifiedText: Optional[str] = None  # Just the transformed portion
    error: Optional[str] = None


def get_text_transform_prompt(command: str, options: Optional[TextTransformOptions] = None) -> str:
    """Get the system prompt for text transformation based on command."""
    if command == "improve":
        return """You are a professional editor. Your task is to improve the writing quality, clarity, and flow of the text within the brackets [AI_SEL_START] and [AI_SEL_END].

Rules:
1. ONLY modify the text between [AI_SEL_START] and [AI_SEL_END]
2. Keep the brackets in your response with the improved text inside them
3. Do NOT modify any text outside the brackets
4. Preserve the original meaning while making it more professional and polished
5. Return the FULL text with brackets intact"""

    elif command == "fix-grammar":
        return """You are a grammar expert. Your task is to fix all grammar, spelling, and punctuation errors in the text within the brackets [AI_SEL_START] and [AI_SEL_END].

Rules:
1. ONLY modify the text between [AI_SEL_START] and [AI_SEL_END]
2. Keep the brackets in your response with the corrected text inside them
3. Do NOT modify any text outside the brackets
4. Preserve the original meaning and tone
5. Return the FULL text with brackets intact"""

    elif command == "change-tone":
        tone = options.tone if options and options.tone else "professional"
        return f"""You are a writing style expert. Your task is to change the tone of the text within the brackets [AI_SEL_START] and [AI_SEL_END] to be more {tone}.

Rules:
1. ONLY modify the text between [AI_SEL_START] and [AI_SEL_END]
2. Keep the brackets in your response with the tone-adjusted text inside them
3. Do NOT modify any text outside the brackets
4. Preserve the original meaning while adjusting the style and word choice
5. Return the FULL text with brackets intact
6. Target tone: {tone}"""

    else:
        return """You are a writing assistant. Your task is to improve the text within the brackets [AI_SEL_START] and [AI_SEL_END].

Rules:
1. ONLY modify the text between [AI_SEL_START] and [AI_SEL_END]
2. Keep the brackets in your response with the improved text inside them
3. Do NOT modify any text outside the brackets
4. Return the FULL text with brackets intact"""


def extract_bracketed_text(text: str) -> Optional[str]:
    """Extract text between the brackets."""
    start_idx = text.find(TEXT_TRANSFORM_BRACKET_START)
    end_idx = text.find(TEXT_TRANSFORM_BRACKET_END)
    
    if start_idx == -1 or end_idx == -1 or start_idx >= end_idx:
        return None
    
    return text[start_idx + len(TEXT_TRANSFORM_BRACKET_START):end_idx]


def create_text_transform_endpoint(app, model, verify_api_key):
    """
    Create and register the text transform endpoint.
    
    Args:
        app: FastAPI application instance
        model: Gemini model instance
        verify_api_key: Authentication dependency function
    """
    
    @app.post("/api/text-transform", dependencies=[Depends(verify_api_key)])
    async def text_transform(
        request: TextTransformRequest,
        x_workspace_id: Optional[str] = Header(None),
        x_user_id: Optional[str] = Header(None)
    ):
        """
        Transform text using AI (improve, fix grammar, change tone)
        
        The text comes with special brackets [AI_SEL_START] and [AI_SEL_END] marking
        the portion that should be transformed. The AI will only modify the text
        within these brackets.
        
        Parameters:
        - command: 'improve', 'fix-grammar', or 'change-tone'
        - blockTextWithBrackets: The full block text with bracket markers
        - selectedText: The text between the brackets (for reference)
        - options: Optional parameters (e.g., tone for change-tone command)
        
        Returns:
        - transformedBlockText: Full block with transformed text in brackets
        - modifiedText: Just the transformed portion (extracted from brackets)
        """
        start_time = datetime.now()
        
        logger.info("=" * 80)
        logger.info("[TEXT TRANSFORM] Received text transform request")
        logger.info(f"[TEXT TRANSFORM] Command: {request.command}")
        logger.info(f"[TEXT TRANSFORM] Block text length: {len(request.blockTextWithBrackets)} characters")
        logger.info(f"[TEXT TRANSFORM] Selected text length: {len(request.selectedText)} characters")
        logger.info(f"[TEXT TRANSFORM] Selected text preview: {request.selectedText[:100]}..." if len(request.selectedText) > 100 else f"[TEXT TRANSFORM] Selected text: {request.selectedText}")
        logger.info(f"[TEXT TRANSFORM] Options: {request.options}")
        logger.info(f"[TEXT TRANSFORM] Workspace: {x_workspace_id}, User: {x_user_id}")
        
        try:
            # Validate that brackets exist
            if TEXT_TRANSFORM_BRACKET_START not in request.blockTextWithBrackets or TEXT_TRANSFORM_BRACKET_END not in request.blockTextWithBrackets:
                raise HTTPException(
                    status_code=400, 
                    detail="Block text must contain [AI_SEL_START] and [AI_SEL_END] markers"
                )
            
            # Get the appropriate prompt for this command
            system_prompt = get_text_transform_prompt(request.command, request.options)
            logger.info(f"[TEXT TRANSFORM] Using prompt for command: {request.command}")
            
            # Build the full prompt
            user_prompt = f"""Here is the text to transform. Remember to ONLY modify the text between the brackets and return the FULL text with brackets intact:

{request.blockTextWithBrackets}"""
            
            logger.info(f"[TEXT TRANSFORM] Sending to Gemini model")
            
            # Call Gemini
            chat_session = model.start_chat(history=[
                {"role": "user", "parts": [system_prompt]},
                {"role": "model", "parts": ["I understand. I will only modify the text within the [AI_SEL_START] and [AI_SEL_END] brackets and return the full text with brackets intact."]}
            ])
            
            response = chat_session.send_message(user_prompt)
            
            # Get the response text
            transformed_text = ""
            if hasattr(response, 'text'):
                transformed_text = response.text.strip()
            
            logger.info(f"[TEXT TRANSFORM] Response received: {len(transformed_text)} characters")
            logger.info(f"[TEXT TRANSFORM] Response preview: {transformed_text[:200]}..." if len(transformed_text) > 200 else f"[TEXT TRANSFORM] Response: {transformed_text}")
            
            # Validate that the response contains the brackets
            if TEXT_TRANSFORM_BRACKET_START not in transformed_text or TEXT_TRANSFORM_BRACKET_END not in transformed_text:
                logger.warning("[TEXT TRANSFORM] Response missing brackets, attempting to reconstruct")
                # If AI didn't include brackets, try to wrap the response
                # This is a fallback - the AI should include them
                # Find the original text outside brackets
                orig_start_idx = request.blockTextWithBrackets.find(TEXT_TRANSFORM_BRACKET_START)
                orig_end_idx = request.blockTextWithBrackets.find(TEXT_TRANSFORM_BRACKET_END)
                before = request.blockTextWithBrackets[:orig_start_idx]
                after = request.blockTextWithBrackets[orig_end_idx + len(TEXT_TRANSFORM_BRACKET_END):]
                # The transformed text is the AI's response
                transformed_text = f"{before}{TEXT_TRANSFORM_BRACKET_START}{transformed_text}{TEXT_TRANSFORM_BRACKET_END}{after}"
            
            # Extract the modified text from brackets
            modified_text = extract_bracketed_text(transformed_text)
            
            if not modified_text:
                logger.error("[TEXT TRANSFORM] Could not extract modified text from response")
                return TextTransformResponse(
                    success=False,
                    error="Could not extract modified text from AI response"
                )
            
            duration = (datetime.now() - start_time).total_seconds()
            logger.info(f"[TEXT TRANSFORM] Completed in {duration:.2f}s")
            logger.info(f"[TEXT TRANSFORM] Modified text: {modified_text[:100]}..." if len(modified_text) > 100 else f"[TEXT TRANSFORM] Modified text: {modified_text}")
            logger.info("=" * 80)
            
            return TextTransformResponse(
                success=True,
                transformedBlockText=transformed_text,
                modifiedText=modified_text
            )
            
        except HTTPException:
            raise
        except Exception as e:
            error_msg = str(e)
            duration = (datetime.now() - start_time).total_seconds()
            logger.error("=" * 80)
            logger.error(f"[TEXT TRANSFORM ERROR] Error after {duration:.2f}s")
            logger.error(f"[TEXT TRANSFORM ERROR] Error type: {type(e).__name__}")
            logger.error(f"[TEXT TRANSFORM ERROR] Error message: {error_msg}")
            import traceback
            logger.error(f"[TEXT TRANSFORM ERROR] Traceback:\n{traceback.format_exc()}")
            logger.error("=" * 80)
            
            return TextTransformResponse(
                success=False,
                error=f"Error transforming text: {error_msg}"
            )
    
    return text_transform

