# backend/tools/slack.py
# Slack webhook wrapper

import httpx
import logging
from core.config import settings

logger = logging.getLogger(__name__)

async def send_slack_notification(message: str, job_id: str = None, decision: str = None):
    """
    Sends a formatted notification to Slack.
    """
    if not settings.SLACK_WEBHOOK_URL or "REPLACE_ME" in settings.SLACK_WEBHOOK_URL:
        logger.info(f"Slack Notification (Mock): {message} | Job: {job_id} | Decision: {decision}")
        return {"sent": False, "mock": True}

    emoji = {"STRONG_YES": "🟢", "SOFT_YES": "🟡", "NO": "🔴"}.get(decision, "⚪")
    
    text = f"{emoji} *New candidate decision*"
    if decision:
        text += f" [{decision}]"
    text += f"\n{message}"
    if job_id:
        text += f"\nJob ID: `{job_id}`"
    
    payload = {"text": text}
    
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(settings.SLACK_WEBHOOK_URL, json=payload)
            return {"sent": resp.status_code == 200}
        except Exception as e:
            logger.error(f"Slack notification failed: {e}")
            return {"sent": False, "error": str(e)}

async def send_slack_alert(message: str):
    """
    Sends a high-priority alert to Slack.
    """
    if not settings.SLACK_WEBHOOK_URL or "REPLACE_ME" in settings.SLACK_WEBHOOK_URL:
        logger.info(f"Slack Alert (Mock): {message}")
        return {"sent": False, "mock": True}

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            await client.post(settings.SLACK_WEBHOOK_URL, json={"text": f"🚨 *ALERT*: {message}"})
        except Exception as e:
            logger.error(f"Slack alert failed: {e}")
            pass  # Best-effort alerting
