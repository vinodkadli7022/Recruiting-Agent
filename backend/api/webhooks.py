# backend/api/webhooks.py
# ============================================================
# Webhook API Endpoints
# ============================================================

from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import hashlib
import hmac
import uuid
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from core.models import Job, JobStatus
from core.config import settings
from core.websocket_manager import manager
from tracing.omium import tracer

router = APIRouter()


class ApplicantPayload(BaseModel):
    name: str
    email: EmailStr
    linkedin_url: Optional[str] = None
    github_handle: Optional[str] = None
    resume_text: Optional[str] = None
    portfolio_url: Optional[str] = None
    phone_number: Optional[str] = None
    role_applied: str
    source: str = "web_form"


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    """Verify webhook came from a trusted source"""
    expected = hmac.new(
        settings.WEBHOOK_SECRET.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


@router.post("/applicant", status_code=202)
async def receive_applicant(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_webhook_signature: Optional[str] = Header(None),
):
    body = await request.body()

    # Verify signature if provided
    if x_webhook_signature:
        if not verify_webhook_signature(body, x_webhook_signature):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload_dict = await request.json()
    payload = ApplicantPayload(**payload_dict)

    # --- DEDUP ENABLED ---
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    result = await db.execute(
        select(Job).where(
            Job.email == payload.email,
            Job.role_applied == payload.role_applied,
            Job.created_at > one_hour_ago,
        ).order_by(Job.created_at.desc())
    )
    existing = result.scalars().first()
    if existing:
        return {
            "job_id": existing.id,
            "status": "deduplicated",
            "message": "Duplicate submission within 1 hour",
        }

    # Create job record immediately
    job_id = str(uuid.uuid4())
    trace_id = tracer.start_trace("applicant_pipeline", {"job_id": job_id})

    job = Job(
        id=job_id,
        status=JobStatus.RECEIVED,
        email=payload.email,
        role_applied=payload.role_applied,
        payload=payload.model_dump(),
        trace_id=trace_id,
    )
    db.add(job)
    await db.commit()

    # --- NON-BLOCKING BROADCAST ---
    asyncio.create_task(manager.broadcast({
        "type": "job_received",
        "job_id": job_id,
        "name": payload.name,
        "role": payload.role_applied,
        "timestamp": datetime.utcnow().isoformat(),
    }))

    # Dispatch to Celery — fire-and-forget (do NOT await)
    # Wrapped in try/except so the webhook still returns 202 if Redis is down.
    # The job is persisted in DB regardless; a recovery sweep can pick it up.
    import logging
    logger = logging.getLogger(__name__)
    try:
        from celery_app import run_pipeline_task
        run_pipeline_task.delay(job_id, payload.model_dump())
    except Exception as e:
        logger.warning(f"Celery dispatch failed (Redis down?): {e}. Job {job_id} saved to DB.")

    return {"job_id": job_id, "status": "accepted"}
