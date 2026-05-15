# backend/agents/reasoning.py
# Reasoning Agent — evaluation + decision

import json
import omium
import logging
from typing import Dict, Any

from agents.base import BaseAgent, AgentFailure

logger = logging.getLogger(__name__)

REASONING_SYSTEM = """
You are a senior technical recruiter and engineering hiring manager with 15 years of experience.

You evaluate candidates rigorously but fairly. You look for potential and trajectory,
not just credentials. You do not penalize candidates for thin online presence.

EVALUATION FRAMEWORK:

Step 1 - Evidence inventory
List every piece of evidence. Note confidence scores. Identify gaps.

Step 2 - Requirement matching  
For each key requirement in the job description:
- Evidence FOR they meet it (with confidence)
- Evidence AGAINST (with confidence)
- Gap assessment

Step 3 - Red flag analysis
Are any red flags disqualifying? Or just yellow flags worth noting?

Step 4 - Trajectory assessment
Is this person growing? Are they on an upward trajectory even if not senior yet?

Step 5 - Decision
STRONG_YES: Clear fit, strong evidence, schedule interview immediately
SOFT_YES: Likely fit but gaps or uncertainty, send interest email, flag for review
NO: Clear mismatch with positive evidence of misalignment (not just absence of evidence)

CRITICAL RULES:
- Thin data = SOFT_YES with "insufficient_data" flag. Never default-reject.
- Overqualified candidates get "overqualified" flag, still SOFT_YES unless they asked.
- Career changers: evaluate trajectory and transferable skills, not just direct experience.
- A confident NO requires positive evidence of mismatch, not just missing data.

Return ONLY valid JSON:
{
  "decision": "STRONG_YES|SOFT_YES|NO",
  "confidence": float (0-1),
  "rationale": string (3-5 sentences, plain English),
  "evidence_summary": {
    "strong_positives": [string],
    "concerns": [string],
    "unknowns": [string]
  },
  "flags": ["insufficient_data", "overqualified", "career_changer", "red_flag_minor", "red_flag_major"],
  "email_tone": "enthusiastic|warm|professional|gentle",
  "talking_points": [string],
  "rejection_reason": string|null
}
"""

JOB_DESCRIPTION = """
We are hiring a Senior Software Engineer (Backend/Systems).

Required:
- 3+ years backend engineering experience
- Strong Python or Go or Rust skills  
- Experience with distributed systems or high-scale APIs
- Comfort with databases (SQL + NoSQL)
- Collaborative, communicates clearly

Nice to have:
- Open source contributions
- Experience at a startup
- Machine learning or AI exposure
- System design experience

We value: trajectory over credentials, curiosity, and shipping real things.
"""

class ReasoningAgent(BaseAgent):
    name = "reasoning"
    
    @omium.trace()
    async def run(self, job_id: str, payload: Dict[str, Any], research: Dict[str, Any]) -> Dict[str, Any]:
        user_message = f"""
Evaluate this candidate for our engineering role.

JOB DESCRIPTION:
{JOB_DESCRIPTION}

CANDIDATE PROFILE (from research agent):
{json.dumps(research, indent=2)[:3000]}

CANDIDATE SELF-REPORTED:
Name: {payload.get('name', 'Unknown')}
Role Applied: {payload.get('role_applied', 'Unknown')}
Resume: {(payload.get('resume_text') or 'Not provided')[:1500]}

Research data quality: {research.get('data_quality', 'unknown')}
Research confidence: {research.get('overall_confidence', 0)}

Evaluate thoroughly. Return valid JSON only.
"""
        
        raw_result = await self.run_with_tools(
            system=REASONING_SYSTEM,
            user_message=user_message,
            tools=[],  # Reasoning agent uses no tools — pure reasoning
            tool_executor=None,
            job_id=job_id,
            span_name="reasoning.evaluate"
        )
        
        result = self._extract_json(raw_result)
        
        # Validate decision
        valid_decisions = ["STRONG_YES", "SOFT_YES", "NO"]
        if result.get("decision") not in valid_decisions:
            logger.error(f"Invalid decision from reasoning agent: {result.get('decision')}")
            raise AgentFailure(f"Invalid decision: {result.get('decision')}")
        
        # Validate confidence
        if not 0 <= result.get("confidence", -1) <= 1:
            result["confidence"] = 0.5 # Default if missing/invalid
        
        # Safety check: insufficient evidence should not result in NO
        if result.get("decision") == "NO" and research.get("data_quality") == "low":
            result["decision"] = "SOFT_YES"
            result["flags"] = result.get("flags", []) + ["auto_upgraded_thin_data"]
            result["rationale"] = f"[Auto-upgraded from NO due to thin data] {result.get('rationale', '')}"
        
        return result
