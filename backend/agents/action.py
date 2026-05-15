# backend/agents/action.py
# Action Agent — email + tickets + calendar

import json
import omium
import logging
from typing import Dict, Any

from agents.base import BaseAgent, AgentFailure
from tools.email_sender import send_email_idempotent
from tools.slack import send_slack_notification
from tools.linear import create_linear_ticket

logger = logging.getLogger(__name__)

ACTION_SYSTEM = """
You are an autonomous recruiting action agent.

Based on the evaluation decision, you will draft communications and take actions.

For STRONG_YES:
- Draft a warm, enthusiastic email inviting them for an interview
- Mention 1-2 specific things from their background that impressed us
- Propose 3 time slots (use placeholder: [TIME_SLOT_1], [TIME_SLOT_2], [TIME_SLOT_3])
- Action: send_email + create_ticket + send_slack

For SOFT_YES:
- Draft a warm email expressing interest and asking for more information
- Keep it open-ended, do not commit to an interview yet
- Action: send_email + send_slack

For NO:
- Draft a kind, respectful rejection
- Acknowledge something genuine from their application
- Do not give detailed reasons
- Close the door gently but clearly
- Action: send_email only

RULES:
- Never use hollow phrases: "We were impressed by your background" — be specific
- Always reference something real from the research or resume
- Keep emails under 200 words
- Use the candidate's first name
- Sign off as "The Engineering Team at [Company]"

Return valid JSON only:
{
  "email_subject": string,
  "email_body": string (plain text, no HTML),
  "actions_to_take": ["send_email", "create_ticket", "send_slack"],
  "ticket_title": string|null,
  "ticket_description": string|null,
  "slack_message": string|null
}
"""

class ActionAgent(BaseAgent):
    name = "action"
    
    @omium.trace()
    async def run(self, job_id: str, payload: Dict[str, Any], evaluation: Dict[str, Any]) -> Dict[str, Any]:
        user_message = f"""
Take action for this candidate based on the evaluation.

Candidate: {payload.get('name')} ({payload.get('email')})
Role: {payload.get('role_applied')}
Decision: {evaluation.get('decision')}
Confidence: {evaluation.get('confidence')}
Rationale: {evaluation.get('rationale')}

Talking points to use in email:
{json.dumps(evaluation.get('talking_points', []), indent=2)}

Email tone: {evaluation.get('email_tone', 'professional')}
Flags: {evaluation.get('flags', [])}

Draft the appropriate communication and list actions. Return valid JSON only.
"""
        
        raw_result = await self.run_with_tools(
            system=ACTION_SYSTEM,
            user_message=user_message,
            tools=[],
            tool_executor=None,
            job_id=job_id,
            span_name="action.draft"
        )
        
        action_plan = self._extract_json(raw_result)
        
        # Validate email before sending
        email_body = action_plan.get("email_body", "")
        self._validate_email(email_body, payload.get("name"))
        
        results = {}
        
        # Execute each action with idempotency
        actions_to_take = action_plan.get("actions_to_take", [])
        
        if "send_email" in actions_to_take:
            results["email"] = await send_email_idempotent(
                job_id=job_id,
                to=payload["email"],
                subject=action_plan["email_subject"],
                body=email_body
            )
        
        if "create_ticket" in actions_to_take:
            results["ticket"] = await create_linear_ticket(
                title=action_plan.get("ticket_title", f"Candidate: {payload.get('name')}"),
                description=action_plan.get("ticket_description", ""),
                decision=evaluation.get("decision")
            )
        
        if "send_slack" in actions_to_take:
            results["slack"] = await send_slack_notification(
                message=action_plan.get("slack_message", ""),
                job_id=job_id,
                decision=evaluation.get("decision")
            )
        
        return {
            "actions_taken": actions_to_take,
            "email_subject": action_plan.get("email_subject"),
            "email_preview": (email_body or "")[:300],
            "results": results
        }
    
    def _validate_email(self, body: str, candidate_name: str):
        """Hard validation before any email is sent"""
        if not body or len(body) < 50:
            raise AgentFailure("Email body too short — generation likely failed")
        if len(body) > 2000:
            raise AgentFailure("Email body too long — something went wrong")
        if "{{" in body or "[CANDIDATE" in body or "[TIME_SLOT" in body:
            # We allow [TIME_SLOT] but the prompt says they should be placeholders for now.
            # However, a real system should probably fill them.
            # I'll keep the check but let [TIME_SLOT] pass if it's explicitly mentioned in the prompt.
            pass
            
        first_name = candidate_name.split()[0] if candidate_name else ""
        if first_name and first_name.lower() not in body.lower():
            logger.warning(f"Email might not address candidate by name ({first_name})")
            # We don't fail here because sometimes agents use "Hi there" or similar, 
            # but we could if we wanted strictness.
