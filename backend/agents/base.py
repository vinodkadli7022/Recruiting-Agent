# backend/agents/base.py
# ============================================================
# STEP 5: Base Agent Class — GROQ REWRITE
# ============================================================

import json
import time
import uuid
import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any, Optional, Dict

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
        span_name: str
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

        with tracer.span(span_name, job_id=job_id):
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
                    return message.content or ""

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
                        try:
                            tool_input = json.loads(tool_call.function.arguments)
                        except json.JSONDecodeError:
                            tool_input = {}
                        
                        try:
                            with tracer.span(f"tool.{tool_name}", job_id=job_id):
                                result = await tool_executor(tool_name, tool_input)
                            # Safety trim for 8B context window
                            content = json.dumps(result)
                            if len(content) > 2500:
                                content = content[:2500] + "... [TRUNCATED]"

                            tool_results.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": content
                            })
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
