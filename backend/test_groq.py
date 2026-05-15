# backend/test_groq.py
import asyncio
import os
import sys

# Add backend to path so we can import agents
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agents.base import BaseAgent

class DummyAgent(BaseAgent):
    name = "test"
    async def execute_tool(self, name, inp):
        print(f"Tool {name} called with input: {inp}")
        return {"weather": "sunny", "temp": 25, "ok": True}

async def run_test():
    print("Testing Groq Integration...")
    agent = DummyAgent()
    try:
        result = await agent.run_with_tools(
            system="You are a helpful assistant. Use the get_weather tool to answer the user.",
            user_message="What's the weather in San Francisco?",
            tools=[{
                "name": "get_weather",
                "description": "Get current weather for a city",
                "input_schema": {
                    "type": "object", 
                    "properties": {
                        "city": {"type": "string"}
                    },
                    "required": ["city"]
                }
            }],
            tool_executor=agent.execute_tool,
            job_id="test-job-id",
            span_name="test-span"
        )
        print(f"\nFinal Result: {result}")
    except Exception as e:
        print(f"\nError: {e}")

if __name__ == "__main__":
    asyncio.run(run_test())
