# backend/api/jobs.py
# ============================================================
# Missing file from original prompt — implemented now
# GET /jobs and GET /jobs/{id} endpoints
# ============================================================

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from core.models import Job, AgentStep

from pydantic import BaseModel

class SearchQuery(BaseModel):
    query: str
    limit: int = 5

router = APIRouter()

@router.post("/search")
async def semantic_search(
    body: SearchQuery,
    db: AsyncSession = Depends(get_db),
):
    """Perform Semantic RAG Search using pgvector cosine similarity."""
    from core.vector import get_embedding
    
    # 1. Convert the recruiter's plain-text search into a math vector
    query_vector = get_embedding(body.query)
    
    # 2. Ask Supabase pgvector to find the mathematically closest candidates
    # .cosine_distance() calculates the angle between vectors
    result = await db.execute(
        select(Job, Job.semantic_embedding.cosine_distance(query_vector).label("distance"))
        .where(Job.semantic_embedding.is_not(None))
        .order_by(Job.semantic_embedding.cosine_distance(query_vector))
        .limit(body.limit)
    )
    
    # 3. Format the results
    search_results = []
    for row in result.all():
        job = row[0]
        distance = row[1]
        
        search_results.append({
            "id": job.id,
            "job_id": job.id,
            "payload": job.payload,
            "role_applied": job.role_applied,
            "decision": job.decision.value if job.decision else None,
            "evaluation": job.evaluation,
            "match_score": round((1 - distance) * 100, 1) # Convert distance to a 0-100% Match Score
        })
        
    return search_results

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
    # Eagerly load steps and thoughts for all jobs to keep demo UI fast
    jobs_data = []
    for j in jobs:
        steps_result = await db.execute(
            select(AgentStep)
            .where(AgentStep.job_id == j.id)
            .order_by(AgentStep.created_at.asc())
        )
        steps = steps_result.scalars().all()
        
        jobs_data.append({
            "id": j.id,
            "job_id": j.id,
            "payload": j.payload,
            "email": j.email,
            "role_applied": j.role_applied,
            "status": j.status.value if j.status else None,
            "decision": j.decision.value if j.decision else None,
            "evaluation": j.evaluation,
            "thoughts": j.thoughts or [],
            "agent_steps": [
                {
                    "id": s.id,
                    "agent": s.agent_name,
                    "step": s.step_name,
                    "status": s.status,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in steps
            ],
            "created_at": j.created_at.isoformat() if j.created_at else None,
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

    # Fetch agent steps for this job
    steps_result = await db.execute(
        select(AgentStep)
        .where(AgentStep.job_id == job_id)
        .order_by(AgentStep.created_at.asc())
    )
    steps = steps_result.scalars().all()

    return {
        "job_id": job.id,
        "status": job.status.value if job.status else None,
        "email": job.email,
        "role_applied": job.role_applied,
        "payload": job.payload,
        "research_result": job.research_result,
        "evaluation": job.evaluation,
        "decision": job.decision.value if job.decision else None,
        "outcome": job.outcome,
        "error": job.error,
        "trace_id": job.trace_id,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "steps": [
            {
                "id": s.id,
                "agent": s.agent_name,
                "step": s.step_name,
                "status": s.status,
                "output_data": s.output_data,
                "duration_ms": s.duration_ms,
                "error": s.error,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in steps
        ],
    }
