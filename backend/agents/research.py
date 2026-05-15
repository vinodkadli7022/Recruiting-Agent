# backend/agents/research.py
# Research Agent — web search + enrichment

import json
import logging
from typing import Dict, Any

from agents.base import BaseAgent, AgentFailure
from tools.search import tavily_search
from tools.github import get_github_profile, get_github_pr_comments

logger = logging.getLogger(__name__)

RESEARCH_SYSTEM = """
You are an expert recruiting research agent. Your job is to build a comprehensive 
intelligence profile on a job candidate using web search and APIs.
Use GitHub tools to check their profile AND their recent PR comments if a username is provided.
Analyze their PR comments for technical communication quality.

RULES:
- Make at most 4 tool calls total. Be extremely selective.
- If a data source returns nothing, mark it NOT_FOUND. Never hallucinate data.
- Assign a confidence score (0.0-1.0) to each piece of information.
- A thin profile (no online presence) is valid. Mark data_quality: "low" and continue.
- TRUNCATE all tool responses mentally; focus only on top-tier evidence.

You must return a JSON object with this exact structure:
{
  "candidate_name": string,
  "data_quality": "high|medium|low",
  "overall_confidence": float (0-1),
  "linkedin": {
    "current_role": string|null,
    "current_company": string|null,
    "years_experience": number|null,
    "past_companies": [string],
    "education": string|null,
    "confidence": float
  },
  "github": {
    "found": boolean,
    "total_stars": number|null,
    "primary_languages": [string],
    "notable_repos": [{"name": string, "stars": number, "description": string}],
    "commit_frequency": "active|moderate|inactive|unknown",
    "confidence": float
  },
  "public_presence": {
    "blog_posts": [string],
    "conference_talks": [string],
    "notable_mentions": [string]
  },
  "red_flags": [{"flag": string, "severity": "low|medium|high", "evidence": string}],
  "positive_signals": [{"signal": string, "evidence": string}],
  "data_conflicts": [{"field": string, "source1": string, "source2": string}],
  "raw_notes": string
}

Output ONLY valid JSON. No markdown code blocks unless you are forced to, but the orchestrator expects raw JSON.
"""

class ResearchAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.name = "research"
    
    TOOLS = [
        {
            "name": "web_search",
            "description": "Search the web for information. Use specific queries.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "purpose": {"type": "string", "description": "What you're looking for and why"}
                },
                "required": ["query", "purpose"]
            }
        },
        {
            "name": "github_profile",
            "description": "Fetch a GitHub user's profile, repositories, and activity",
            "input_schema": {
                "type": "object",
                "properties": {
                    "username": {"type": "string"}
                },
                "required": ["username"]
            }
        }
    ]
    
    async def execute_tool(self, tool_name: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name == "web_search":
            result = await tavily_search(tool_input["query"])
            # FORCE TRUNCATION: Keep only the first 1200 chars to prevent 413 Payload Too Large
            return str(result)[:1200] if result else "No results found."
        elif tool_name == "github_profile":
            return await get_github_profile(tool_input["username"])
        elif tool_name == "get_github_pr_comments":
            return await get_github_pr_comments(**tool_input)
        else:
            return {"error": f"Unknown tool: {tool_name}"}
    
    async def run(self, job_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        user_message = f"""
Research this candidate thoroughly:

Name: {payload.get('name', 'Unknown')}
Email: {payload.get('email', 'Unknown')}
LinkedIn URL: {payload.get('linkedin_url') or 'Not provided'}
GitHub Handle: {payload.get('github_handle') or 'Not provided'}
Portfolio URL: {payload.get('portfolio_url') or 'Not provided'}
Role Applied: {payload.get('role_applied', 'Unknown')}

Resume Text:
{(payload.get('resume_text') or 'Not provided')[:2000]}

Build a comprehensive profile. Return valid JSON only.
"""
        
        raw_result = await self.run_with_tools(
            system=RESEARCH_SYSTEM,
            user_message=user_message,
            tools=self.TOOLS,
            tool_executor=self.execute_tool,
            job_id=job_id,
            span_name="research.enrich"
        )
        
        # Parse and validate the result using the helper
        result = self._extract_json(raw_result)
        
        # Validate required fields
        required = ["data_quality", "overall_confidence", "linkedin", "github", "red_flags"]
        for field in required:
            if field not in result:
                # If a field is missing, we don't necessarily want to fail the whole pipeline,
                # but we should at least provide a default or log it.
                logger.warning(f"Research result missing field: {field}")
                result[field] = result.get(field, None if field != "red_flags" else [])
                
        return result
