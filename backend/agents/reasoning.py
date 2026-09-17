# backend/agents/reasoning.py
# Reasoning Agent — Evidence-Based Candidate Evaluation

import json
import logging
from typing import Dict, Any

from agents.base import BaseAgent, AgentFailure

logger = logging.getLogger(__name__)

REASONING_SYSTEM = """
You are a senior technical recruiting copilot. Your purpose is to evaluate candidate evidence against job requirements and produce an evidence-grounded evaluation for a human recruiter.

CORE COPILOT PRINCIPLES:
1. Ground every claim in concrete evidence from the resume or GitHub research.
2. Distinguish clearly between submitted evidence (resume) and external discovery (GitHub repos/stars).
3. If evidence is missing (e.g. no verified cloud deployment or private repositories), EXPLICITLY state it in "missing_evidence" rather than making negative assumptions.
4. Do NOT evaluate or reference protected characteristics, age, gender, race, location, or personal background.
5. Provide a clear recommendation (e.g. "Advance to Technical Screen", "Review Further", "Decline").

You must output valid JSON matching this schema:
{
  "decision": "STRONG_YES" | "SOFT_YES" | "NO",
  "recommendation": "Advance to Technical Screen" | "Review Further" | "Decline",
  "confidence_score": 0-100,
  "summary": "2-3 sentence evidence-based summary for the recruiter.",
  "scorecard": {
    "technical_depth": {
      "score": 1-10,
      "confidence": 0.0-1.0,
      "explanation": "Brief reasoning based on code evidence",
      "evidence": [
        {
          "source_type": "github" | "resume" | "web",
          "locator": "repository name or resume section",
          "quote": "specific evidence or project name"
        }
      ],
      "missing_evidence": ["what could not be verified"]
    },
    "experience_match": {
      "score": 1-10,
      "confidence": 0.0-1.0,
      "explanation": "Match with role requirements",
      "evidence": [{"source_type": "resume", "locator": "experience", "quote": "..."}],
      "missing_evidence": []
    },
    "code_quality_and_architecture": {
      "score": 1-10,
      "confidence": 0.0-1.0,
      "explanation": "Code structure, testing, modularity",
      "evidence": [{"source_type": "github", "locator": "code", "quote": "..."}],
      "missing_evidence": []
    },
    "growth_trajectory": {
      "score": 1-10,
      "confidence": 0.0-1.0,
      "explanation": "Learning rate and project complexity over time",
      "evidence": [],
      "missing_evidence": []
    }
  },
  "strengths": ["Key strength 1 with evidence", "Key strength 2 with evidence"],
  "concerns": ["Potential gap or area to probe in interview"],
  "missing_evidence_summary": ["List of things not verified"],
  "personalized_hook": "Specific technical detail from their GitHub/resume for personalized outreach."
}

Return ONLY valid JSON.
"""

JOB_DESCRIPTION = """
Role: Software Engineer (Full-Stack / Backend)
Required:
- Strong programming fundamentals in Python, TypeScript/JavaScript, or Go.
- Experience with web frameworks (FastAPI, Node.js, Express, React) and relational/NoSQL databases.
- Ability to design, build, and deploy functional software systems.
- Track record of building personal or open-source projects.
"""

class ReasoningAgent(BaseAgent):
    name = "reasoning"
    
    async def run(self, job_id: str, payload: Dict[str, Any], research: Dict[str, Any], parent_trace_id: str = None) -> Dict[str, Any]:
        await self.log_thought(job_id, "Synthesizing candidate evidence from resume and GitHub activity...")
        await self.log_thought(job_id, f"Mapping verified technical artifacts against rubric for role: {payload.get('role_applied')}")
        
        user_message = f"""
Evaluate this candidate for the specified role.

JOB DESCRIPTION:
{JOB_DESCRIPTION}

ROLE APPLIED: {payload.get('role_applied')}

CANDIDATE SUBMISSION:
Name: {payload.get('name')}
Email: {payload.get('email')}
Resume Text: {(payload.get('resume_text') or 'Not provided')[:2500]}

RESEARCH EVIDENCE COLLECTED:
{json.dumps(research, indent=2)}

Produce a rigorous, evidence-linked scorecard adhering strictly to the schema.
"""
        
        raw_result = await self.run_with_tools(
            system=REASONING_SYSTEM,
            user_message=user_message,
            tools=[],
            tool_executor=None,
            job_id=job_id,
            span_name="reasoning.evaluate",
            parent_trace_id=parent_trace_id
        )
        
        evaluation = self._extract_json(raw_result)
        
        # Ensure decision is normalized
        decision = evaluation.get("decision", "SOFT_YES").upper()
        if decision not in ["STRONG_YES", "SOFT_YES", "NO"]:
            decision = "SOFT_YES"
        evaluation["decision"] = decision
        
        # Guard against ungrounded rejection on thin data
        if research.get("data_quality") == "low" and decision == "NO":
            evaluation["decision"] = "SOFT_YES"
            evaluation["summary"] += " [Note: Evaluation adjusted to Review Further due to limited public data.]"
            
        await self.log_thought(job_id, f"Evaluation generated: {evaluation.get('recommendation', decision)} with {evaluation.get('confidence_score', 80)}% confidence.")
        return evaluation
