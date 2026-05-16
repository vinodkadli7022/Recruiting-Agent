# backend/agents/base.py
# ============================================================
# STEP 5: Base Agent Class — GROQ REWRITE
# ============================================================

import json
import time
import uuid
import asyncio
import logging
from datetime import datetime
from abc import ABC, abstractmethod
from typing import Any, Optional, Dict
from sqlalchemy import select

from groq import AsyncGroq
from core.config import settings
from core.database import get_db_session
from core.models import AgentStep
from core.websocket_manager import manager
from tracing.omium import tracer

logger = logging.getLogger(__name__)

class AgentFailure(Exception):
    pass

class BaseAgent(ABC):
    name: str = "base"
    
    def __init__(self):
        self.client = AsyncGroq(api_key=settings.GROQ_API_KEY)
        self.model = settings.GROQ_MODEL

        self.max_tokens = 4096
        self.max_tool_calls = 10

    async def log_thought(self, job_id: str, thought: str):
        """Broadcast a live thought from the agent to the UI"""
        logger.info(f"[{self.name}] THOUGHT: {thought}")
        if not job_id:
            return
            
        await manager.broadcast({
            "type": "agent_thought",
            "job_id": job_id,
            "agent": self.name,
            "thought": thought,
            "timestamp": datetime.now().isoformat()
        })

        # Persist thought to DB
        try:
            from sqlalchemy import update
            new_thought = {
                "agent": self.name,
                "thought": thought,
                "timestamp": datetime.now().isoformat()
            }
            async with get_db_session() as db:
                # Use a more efficient update if possible, but for demo simple append works
                from core.models import Job
                result = await db.execute(select(Job).where(Job.id == job_id))
                job = result.scalars().first()
                if job:
                    current_thoughts = list(job.thoughts or [])
                    current_thoughts.append(new_thought)
                    job.thoughts = current_thoughts
                    await db.commit()
        except Exception as e:
            logger.error(f"Failed to persist thought to DB: {e}")

    def parse_json_safely(self, raw: str) -> dict:
        """Strip markdown code blocks and parse JSON."""
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first and last line if they are ```json or ```
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from: {raw}")
            raise AgentFailure(f"Invalid JSON response from agent: {str(e)}")

    def _extract_json(self, raw: str) -> dict:
        """Alias for parse_json_safely to maintain compatibility with existing agents."""
        return self.parse_json_safely(raw)

    async def run_with_tools(
        self,
        system: str,
        user_message: str,
        tools: list[dict],
        tool_executor,
        job_id: str,
        span_name: str,
        parent_trace_id: str = None
    ) -> str:
        """
        Groq-compatible agent loop.
        Adapts TOOLS with 'input_schema' (Anthropic style) to 'parameters' (OpenAI style) automatically.
        """
        # Convert Anthropic style tools to OpenAI/Groq style
        formatted_tools = []
        for t in tools:
            if "input_schema" in t and "function" not in t:
                formatted_tools.append({
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["input_schema"]
                    }
                })
            else:
                formatted_tools.append(t)

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_message}
        ]
        tool_call_count = 0

        # Build API parameters
        api_params = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "temperature": 0
        }
        if formatted_tools:
            api_params["tools"] = formatted_tools
            api_params["tool_choice"] = "auto"

        with tracer.span(span_name, parent_id=parent_trace_id, job_id=job_id):
            while tool_call_count < self.max_tool_calls:
                start = time.time()

                try:
                    # Update messages in params for each loop
                    api_params["messages"] = messages
                    response = await self.client.chat.completions.create(**api_params)
                except Exception as e:
                    logger.error(f"Groq API call failed: {e}")
                    raise AgentFailure(f"Groq API error: {str(e)}")

                duration_ms = (time.time() - start) * 1000
                choice = response.choices[0]
                finish_reason = choice.finish_reason
                message = choice.message

                # Log step
                await self._log_step(
                    job_id=job_id,
                    step_name=span_name,
                    status="running" if finish_reason == "tool_calls" else "complete",
                    output_data={"finish_reason": finish_reason},
                    duration_ms=duration_ms
                )

                # No tool calls → return text content
                if finish_reason == "stop":
                    content = message.content or ""
                    # Fallback: Check if model returned tool call JSON in text (common for weak models or 70B glitches)
                    if "{" in content and "function" in content and "arguments" in content:
                        logger.warning("Groq fallback: JSON detected in stop message, attempting to parse as tool call.")
                        # This is an advanced fallback, for now we just fail gracefully if it's empty
                    
                    if not content.strip() and not message.tool_calls:
                        raise AgentFailure("Model returned empty response without tool calls")
                    return content

                # Tool calls requested
                if finish_reason == "tool_calls" and message.tool_calls:
                    tool_call_count += 1
                    tool_results = []

                    # Append assistant message with tool calls BEFORE results
                    # Ensure content is at least empty string, not null
                    messages.append({
                        "role": "assistant",
                        "content": message.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments
                                }
                            } for tc in message.tool_calls
                        ]
                    })

                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        await self.log_thought(job_id, f"Executing tool: {tool_name}...")
                        try:
                            tool_input = json.loads(tool_call.function.arguments)
                        except json.JSONDecodeError:
                            tool_input = {}
                        
                        try:
                            with tracer.span(f"tool.{tool_name}", parent_id=parent_trace_id, job_id=job_id):
                                result = await tool_executor(tool_name, tool_input)
                            
                            # Strict safety trim for Groq Free Tier TPM limits (6k)
                            content = json.dumps(result)
                            if len(content) > 1200:
                                content = content[:1200] + "... [TRUNCATED FOR TPM SAFETY]"

                            tool_results.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": content
                            })
                            await self.log_thought(job_id, f"Tool {tool_name} completed successfully.")
                        except Exception as e:
                            logger.error(f"Tool {tool_name} failed: {e}")
                            tool_results.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": json.dumps({"error": str(e), "status": "failed"})
                            })

                    # Append all tool results
                    messages.extend(tool_results)
                    continue

                raise AgentFailure(f"Unexpected finish_reason: {finish_reason}")

        raise AgentFailure(f"Exceeded max tool calls ({self.max_tool_calls})")

    async def _log_step(self, job_id: str, step_name: str, status: str, output_data: dict, duration_ms: float, error: Optional[str] = None):
        """
        Preserving ASYNC DATABASE session management.
        """
        async with get_db_session() as db:
            step = AgentStep(
                id=str(uuid.uuid4()),
                job_id=job_id,
                agent_name=self.name,
                step_name=step_name,
                status=status,
                output_data=output_data,
                duration_ms=duration_ms,
                error=error
            )
            db.add(step)
            await db.commit()
        
        # Non-blocking broadcast
        asyncio.create_task(manager.broadcast({
            "type": "agent_step",
            "job_id": job_id,
            "agent": self.name,
            "step": step_name,
            "status": status,
            "duration_ms": duration_ms,
            "data": output_data,
            "error": error
        }))
