# backend/tools/email_sender.py
# Resend email wrapper with idempotency

import resend
import uuid
import hashlib
import logging
from datetime import datetime
from core.config import settings
from core.database import get_db_session
from core.models import ActionLog

logger = logging.getLogger(__name__)

# Configure Resend
if settings.RESEND_API_KEY:
    resend.api_key = settings.RESEND_API_KEY

async def send_email_idempotent(job_id: str, to: str, subject: str, body: str) -> dict:
    """
    Send email with idempotency guarantee.
    Uses the ActionLog table to prevent duplicate emails for the same job and recipient.
    """
    # CORRECTION: Simplified but robust idempotency key
    idempotency_key = hashlib.sha256(f"{job_id}:{to}:send_email".encode()).hexdigest()
    
    async with get_db_session() as db:
        # Check if already sent
        from sqlalchemy import select
        result = await db.execute(
            select(ActionLog).where(ActionLog.idempotency_key == idempotency_key)
        )
        existing = result.scalars().first()
        
        if existing and existing.status == "complete":
            logger.info(f"Email already sent for job {job_id} to {to} (cached).")
            return existing.result
        
        if not existing:
            # Log intent before sending
            log = ActionLog(
                id=str(uuid.uuid4()),
                job_id=job_id,
                action_type="send_email",
                idempotency_key=idempotency_key,
                params={"to": to, "subject": subject},
                status="pending"
            )
            db.add(log)
            await db.commit()
        else:
            log = existing

        # Check for API key
        if not settings.RESEND_API_KEY:
            logger.warning("RESEND_API_KEY not set. Mocking email send.")
            mock_result = {"mock": True, "message_id": f"mock_{uuid.uuid4()}", "sent_at": datetime.utcnow().isoformat()}
            log.status = "complete"
            log.result = mock_result
            await db.commit()
            return mock_result

        try:
            # We use loop.run_in_executor because resend SDK is synchronous
            import asyncio
            loop = asyncio.get_event_loop()
            
            # Use Resend onboarding address for instant demo success
            from_email = "onboarding@resend.dev"
            
            response = await loop.run_in_executor(
                None,
                lambda: resend.Emails.send({
                    "from": from_email,
                    "to": to,
                    "subject": subject,
                    "text": body
                })
            )
            
            result = {"message_id": response.get("id"), "sent_at": datetime.utcnow().isoformat()}
            log.status = "complete"
            log.result = result
            await db.commit()
            return result
            
        except Exception as e:
            logger.error(f"Failed to send email via Resend: {e}")
            log.status = "failed"
            log.result = {"error": str(e)}
            await db.commit()
            raise
