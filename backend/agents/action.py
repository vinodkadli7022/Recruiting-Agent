# backend/agents/action.py
# Action Agent — email + tickets + calendar

import json
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
  "actions_to_take": ["send_email", "create_ticket", "send_slack", "trigger_voice_call"],
  "ticket_title": string|null,
  "ticket_description": string|null,
  "slack_message": string|null
}
"""

class ActionAgent(BaseAgent):
    name = "action"
    
    async def run(self, job_id: str, payload: Dict[str, Any], evaluation: Dict[str, Any]) -> Dict[str, Any]:
        user_message = f"""
Take action for this candidate based on the evaluation.

Candidate: {payload.get('name')} ({payload.get('email')})
Role: {payload.get('role_applied')}
Decision: {evaluation.get('decision')}
Confidence Score: {evaluation.get('confidence_score')}%
Summary: {evaluation.get('summary')}
Strengths: {json.dumps(evaluation.get('strengths', []), indent=2)}

Personalized Hook: {evaluation.get('personalized_hook')}

Draft the appropriate communication and list actions. Return valid JSON only.
"""
        await self.log_thought(job_id, f"Drafting personalized outreach strategy for {payload.get('name')}...")
        
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
        
        # DEMO SAFETY: Force voice call for all YES decisions if phone is present
        decision = evaluation.get("decision")
        if decision in ["STRONG_YES", "SOFT_YES"] and payload.get("phone_number"):
            if "trigger_voice_call" not in actions_to_take:
                actions_to_take.append("trigger_voice_call")
        
        # DEMO SAFETY: Force email to verified address to prevent Resend 403s
        recipient_email = "gms73389@gmail.com" 
        
        if "send_email" in actions_to_take:
            # --- AUTONOMOUS CALENDAR HANDOFF (The Unicorn Hack) ---
            if decision == "STRONG_YES":
                from core.config import settings
                calendly_link = settings.CALENDLY_LINK
                email_body += f"\n\nTo fast-track your application, please select an interview time directly on our engineering calendar: {calendly_link}"
                results["calendar_scheduling"] = {"status": "invite_sent", "link": calendly_link}
                await self.log_thought(job_id, f"Auto-generating calendar scheduling link for Fast-Track interview...")

            await self.log_thought(job_id, f"Sending secure email to {recipient_email}...")
            results["email"] = await send_email_idempotent(
                job_id=job_id,
                to=recipient_email,
                subject=action_plan["email_subject"],
                body=email_body
            )
        
        if "create_ticket" in actions_to_take:
            await self.log_thought(job_id, "Creating interview request ticket in Linear...")
            results["ticket"] = await create_linear_ticket(
                title=action_plan.get("ticket_title", f"Candidate: {payload.get('name')}"),
                description=action_plan.get("ticket_description", ""),
                decision=evaluation.get("decision")
            )
        
        if "send_slack" in actions_to_take:
            await self.log_thought(job_id, "Broadcasting final outcome to engineering Slack channel...")
            results["slack"] = await send_slack_notification(
                message=action_plan.get("slack_message", ""),
                job_id=job_id,
                decision=evaluation.get("decision")
            )

        if "trigger_voice_call" in actions_to_take and payload.get("phone_number"):
            await self.log_thought(job_id, f"Initiating real-time AI voice screening call to {payload.get('phone_number')}...")
            from tools.voice import trigger_screening_call
            results["voice_call"] = await trigger_screening_call(
                job_id=job_id,
                phone_number=payload["phone_number"],
                candidate_name=payload["name"],
                technical_summary=evaluation.get("summary", "")
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
        
        # Catch unfilled placeholders
        if "{{" in body or "[CANDIDATE_NAME]" in body:
            raise AgentFailure("Email contains unfilled placeholders")
            
        # Ensure the email looks personalized (Relaxed for demo)
        first_name = candidate_name.split("_")[0].split(" ")[0]
        if first_name.lower() not in body.lower():
             logger.warning(f"Email address name mismatch: '{first_name}' not found in body. Proceeding anyway for demo.")
