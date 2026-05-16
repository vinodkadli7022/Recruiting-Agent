import httpx
import logging
import uuid
import hashlib
from datetime import datetime
from core.config import settings
from core.database import get_db_session
from core.models import ActionLog

logger = logging.getLogger(__name__)

async def trigger_screening_call(job_id: str, phone_number: str, candidate_name: str, technical_summary: str):
    """
    Triggers a real-time AI voice screening call via Vapi.ai with database logging.
    """
    # Idempotency to prevent double-calling
    idempotency_key = hashlib.sha256(f"{job_id}:{phone_number}:voice_call".encode()).hexdigest()
    
    async with get_db_session() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(ActionLog).where(ActionLog.idempotency_key == idempotency_key)
        )
        existing = result.scalars().first()
        
        if existing and existing.status == "complete":
            logger.info(f"Voice call already triggered for job {job_id} (cached).")
            return existing.result
            
        if not existing:
            log = ActionLog(
                id=str(uuid.uuid4()),
                job_id=job_id,
                action_type="trigger_voice_call",
                idempotency_key=idempotency_key,
                params={"phone": phone_number, "name": candidate_name},
                status="pending"
            )
            db.add(log)
            await db.commit()
        else:
            log = existing

        if not settings.VAPI_API_KEY or not settings.VAPI_ASSISTANT_ID or not settings.VAPI_PHONE_NUMBER_ID:
            logger.warning("Vapi keys or Phone ID missing. Skipping call.")
            res = {"status": "mock", "message": "API keys missing"}
            log.status = "complete"
            log.result = res
            await db.commit()
            return res

        url = "https://api.vapi.ai/call"
        payload = {
            "assistantId": settings.VAPI_ASSISTANT_ID,
            "phoneNumberId": settings.VAPI_PHONE_NUMBER_ID,
            "customer": {"number": phone_number, "name": candidate_name},
            "assistantOverrides": {
                "variableValues": {
                    "tech_context": technical_summary,
                    "candidate_name": candidate_name
                }
            }
        }
        
        headers = {
            "Authorization": f"Bearer {settings.VAPI_API_KEY}",
            "Content-Type": "application/json"
        }

        # DEBUG: Log the payload keys (not full values for safety)
        logger.info(f"Triggering Vapi call with Assistant: {settings.VAPI_ASSISTANT_ID[:6]}... and PhoneID: {settings.VAPI_PHONE_NUMBER_ID[:6]}...")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if response.status_code != 200:
                    logger.error(f"Vapi Error Response: {response.text}")
                response.raise_for_status()
                data = response.json()
                
                result = {"status": "success", "call_id": data.get("id"), "sent_at": datetime.utcnow().isoformat()}
                log.status = "complete"
                log.result = result
                await db.commit()
                return result
        except Exception as e:
            logger.error(f"Vapi call failed: {e}")
            log.status = "failed"
            log.result = {"error": str(e)}
            await db.commit()
            return log.result
