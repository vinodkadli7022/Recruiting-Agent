# backend/api/jobs.py
# ============================================================
# Job Management API Endpoints
# ============================================================

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from core.models import Job, AgentStep, ActionLog, JobStatus
from core.config import settings

from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class SearchQuery(BaseModel):
    query: str
    limit: int = 5

class ReviewDecision(BaseModel):
    approved: bool
    reviewer: str = "recruiter"

class OutreachEdit(BaseModel):
    email_subject: Optional[str] = None
    email_body: Optional[str] = None

router = APIRouter()


@router.post("/search")
async def semantic_search(
    body: SearchQuery,
    db: AsyncSession = Depends(get_db),
):
    """Perform Semantic RAG Search using pgvector cosine similarity (or Python fallback for SQLite)."""
    from core.vector import get_embedding

    query_vector = get_embedding(body.query)

    if settings.DATABASE_URL.startswith("sqlite"):
        result = await db.execute(select(Job).where(Job.semantic_embedding.is_not(None)))
        import math
        def cosine_distance(a, b):
            dot = sum(x * y for x, y in zip(a, b))
            na  = math.sqrt(sum(x * x for x in a))
            nb  = math.sqrt(sum(y * y for y in b))
            return 1.0 if not na or not nb else 1 - (dot / (na * nb))
        rows = [
            (job, cosine_distance(job.semantic_embedding, query_vector))
            for job in result.scalars().all()
        ]
        rows.sort(key=lambda r: r[1])
        rows = rows[:body.limit]
    else:
        result = await db.execute(
            select(Job, Job.semantic_embedding.cosine_distance(query_vector).label("distance"))
            .where(Job.semantic_embedding.is_not(None))
            .order_by(Job.semantic_embedding.cosine_distance(query_vector))
            .limit(body.limit)
        )
        rows = result.all()

    search_results = []
    for row in rows:
        job      = row[0]
        distance = row[1]
        search_results.append({
            "id":           job.id,
            "job_id":       job.id,
            "payload":      job.payload,
            "role_applied": job.role_applied,
            "decision":     job.decision.value if job.decision else None,
            "evaluation":   job.evaluation,
            "match_score":  round((1 - distance) * 100, 1),
        })

    return search_results


@router.post("/{job_id}/review")
async def review_job(
    job_id: str,
    body: ReviewDecision,
    db: AsyncSession = Depends(get_db),
):
    """
    Recruiter Approve or Reject gate.
    - Approve: queues the Action phase (email, ticket, Slack, voice).
    - Reject:  closes the job with no outreach sent at all.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.evaluation:
        raise HTTPException(status_code=409, detail="Candidate evaluation is not ready yet")
    if job.status not in (JobStatus.AWAITING_REVIEW, JobStatus.COMPLETE):
        raise HTTPException(
            status_code=409,
            detail=f"Job is not awaiting review: {job.status.value if job.status else 'unknown'}"
        )

    if not body.approved:
        job.review_status = "rejected"
        job.reviewed_at   = datetime.utcnow()
        job.reviewed_by   = body.reviewer
        job.status        = JobStatus.COMPLETE
        job.outcome       = {"status": "rejected_by_recruiter", "actions_taken": []}
        await db.commit()
        return {
            "job_id":  job_id,
            "status":  "rejected",
            "message": "No outreach, tickets, Slack alerts, or calls were sent."
        }

    job.review_status = "approved"
    job.reviewed_at   = datetime.utcnow()
    job.reviewed_by   = body.reviewer
    await db.commit()

    try:
        from celery_app import run_approved_action_task
        run_approved_action_task.delay(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not queue approved action: {exc}")

    return {
        "job_id":  job_id,
        "status":  "approved",
        "message": "Approved. Outreach actions are being executed now."
    }


@router.patch("/{job_id}/outreach")
async def update_outreach_draft(
    job_id: str,
    body: OutreachEdit,
    db: AsyncSession = Depends(get_db),
):
    """Allows recruiter to edit prepared outreach email before approving."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    eval_data = dict(job.evaluation or {})
    if body.email_subject is not None:
        eval_data["draft_email_subject"] = body.email_subject
    if body.email_body is not None:
        eval_data["draft_email_body"] = body.email_body
    job.evaluation = eval_data
    await db.commit()
    return {"job_id": job_id, "status": "draft_updated", "evaluation": job.evaluation}


@router.post("/{job_id}/archive")
async def archive_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Archive an application without deleting audit records."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.review_status = "archived"
    await db.commit()
    return {"job_id": job_id, "status": "archived"}


@router.get("/{job_id}/audit-log")
async def get_audit_log(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Display status changes and external action logs for compliance and auditability."""
    result = await db.execute(
        select(ActionLog)
        .where(ActionLog.job_id == job_id)
        .order_by(ActionLog.created_at.asc())
    )
    logs = result.scalars().all()
    return [
        {
            "id":              l.id,
            "action_type":     l.action_type,
            "idempotency_key": l.idempotency_key,
            "status":          l.status,
            "params":          l.params,
            "result":          l.result,
            "created_at":      l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.get("/")
async def list_jobs(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """List all jobs, newest first."""
    result = await db.execute(
        select(Job)
        .order_by(Job.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    jobs = result.scalars().all()
    jobs_data = []
    for j in jobs:
        steps_result = await db.execute(
            select(AgentStep)
            .where(AgentStep.job_id == j.id)
            .order_by(AgentStep.created_at.asc())
        )
        steps = steps_result.scalars().all()
        jobs_data.append({
            "id":            j.id,
            "job_id":        j.id,
            "payload":       j.payload,
            "email":         j.email,
            "role_applied":  j.role_applied,
            "status":        j.status.value if j.status else None,
            "review_status": j.review_status,
            "decision":      j.decision.value if j.decision else None,
            "evaluation":    j.evaluation,
            "outcome":       j.outcome,
            "thoughts":      j.thoughts or [],
            "agent_steps": [
                {
                    "id":         s.id,
                    "agent":      s.agent_name,
                    "step":       s.step_name,
                    "status":     s.status,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in steps
            ],
            "created_at":   j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        })
    return jobs_data


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get full job detail including agent steps."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    steps_result = await db.execute(
        select(AgentStep)
        .where(AgentStep.job_id == job_id)
        .order_by(AgentStep.created_at.asc())
    )
    steps = steps_result.scalars().all()

    return {
        "job_id":          job.id,
        "status":          job.status.value if job.status else None,
        "review_status":   job.review_status,
        "email":           job.email,
        "role_applied":    job.role_applied,
        "payload":         job.payload,
        "research_result": job.research_result,
        "evaluation":      job.evaluation,
        "decision":        job.decision.value if job.decision else None,
        "outcome":         job.outcome,
        "error":           job.error,
        "trace_id":        job.trace_id,
        "created_at":      job.created_at.isoformat() if job.created_at else None,
        "updated_at":      job.updated_at.isoformat() if job.updated_at else None,
        "completed_at":    job.completed_at.isoformat() if job.completed_at else None,
        "steps": [
            {
                "id":          s.id,
                "agent":       s.agent_name,
                "step":        s.step_name,
                "status":      s.status,
                "output_data": s.output_data,
                "duration_ms": s.duration_ms,
                "error":       s.error,
                "created_at":  s.created_at.isoformat() if s.created_at else None,
            }
            for s in steps
        ],
    }
