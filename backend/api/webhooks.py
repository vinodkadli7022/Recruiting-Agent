# backend/api/webhooks.py
# ============================================================
# Webhook API Endpoints
# ============================================================

from fastapi import APIRouter, HTTPException, Header, Request, Depends, UploadFile, File, Form
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import hashlib
import hmac
import uuid
import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from core.models import Job, JobStatus
from core.config import settings
from core.websocket_manager import manager
from tracing.omium import tracer
from tools.resume_parser import parse_resume

logger = logging.getLogger(__name__)

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

    # --- DEDUP (5s for demo) ---
    one_hour_ago = datetime.utcnow() - timedelta(seconds=5)
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
            "message": "Duplicate submission within 5 seconds",
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

    # Dispatch to Celery — fire-and-forget
    try:
        from celery_app import run_pipeline_task
        run_pipeline_task.delay(job_id, payload.model_dump())
    except Exception as e:
        logger.warning(f"Celery dispatch failed (Redis down?): {e}. Job {job_id} saved to DB.")

    return {"job_id": job_id, "status": "accepted"}


@router.post("/resume", status_code=202)
async def receive_resume(
    file: UploadFile = File(...),
    role_applied: Optional[str] = Form("Senior Backend Engineer"),
    db: AsyncSession = Depends(get_db),
):
    """
    Accepts an uploaded PDF resume, extracts candidate information (name, email,
    github_handle, phone, skills), and triggers the autonomous pipeline.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are currently supported.")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        parsed_data = await parse_resume(content)
    except Exception as e:
        logger.error(f"Resume extraction error: {e}")
        raise HTTPException(status_code=422, detail=f"Failed to parse resume: {str(e)}")

    payload = ApplicantPayload(
        name=parsed_data.get("name") or "Candidate",
        email=parsed_data.get("email") or "applicant@example.com",
        github_handle=parsed_data.get("github_handle"),
        linkedin_url=parsed_data.get("linkedin_url"),
        phone_number=parsed_data.get("phone_number"),
        role_applied=role_applied,
        resume_text=parsed_data.get("resume_text"),
        source="resume_upload",
    )

    # Dedup check
    one_hour_ago = datetime.utcnow() - timedelta(seconds=5)
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
            "message": "Duplicate submission within 5 seconds",
            "extracted": {
                "name": payload.name,
                "email": payload.email,
                "github_handle": payload.github_handle,
                "role_applied": payload.role_applied,
            }
        }

    job_id = str(uuid.uuid4())
    trace_id = tracer.start_trace("applicant_pipeline", {"job_id": job_id, "source": "resume_upload"})

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

    # Real-time WebSocket broadcast
    asyncio.create_task(manager.broadcast({
        "type": "job_received",
        "job_id": job_id,
        "name": payload.name,
        "role": payload.role_applied,
        "timestamp": datetime.utcnow().isoformat(),
    }))

    # Dispatch to Celery worker
    try:
        from celery_app import run_pipeline_task
        run_pipeline_task.delay(job_id, payload.model_dump())
    except Exception as e:
        logger.warning(f"Celery dispatch failed: {e}. Job {job_id} saved to DB.")

    return {
        "job_id": job_id,
        "status": "accepted",
        "extracted": {
            "name": payload.name,
            "email": payload.email,
            "github_handle": payload.github_handle,
            "role_applied": payload.role_applied,
            "skills": parsed_data.get("skills", []),
            "summary": parsed_data.get("summary", ""),
        }
    }
