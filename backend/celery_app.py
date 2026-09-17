# backend/celery_app.py
# ============================================================
# Celery Worker Configuration
# ============================================================

import os
import sys
from celery import Celery

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.config import settings

app = Celery(
    "pipeline",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL.replace("/0", "/1"),
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_expires=86400,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    task_soft_time_limit=300,
    task_time_limit=360,
    broker_connection_timeout=1,
    broker_connection_retry_on_startup=True,
)


@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    name="pipeline.run",
)
def run_pipeline_task(self, job_id: str, payload: dict):
    """
    Main pipeline task: Research → Reasoning → (Human Gate or Action).
    If HUMAN_REVIEW_REQUIRED=True, this task ends at awaiting_review state.
    Recruiter approval triggers run_approved_action_task separately.
    """
    import asyncio
    import logging
    from agents.orchestrator import Orchestrator
    from core.database import get_db_session
    from core.models import Job, JobStatus

    logger = logging.getLogger(__name__)
    logger.info(f"[CELERY] Starting pipeline task for job_id={job_id}")

    try:
        orchestrator = Orchestrator()
        asyncio.run(orchestrator.dispatch(job_id, payload))
        logger.info(f"[CELERY] Pipeline task completed for job_id={job_id}")

    except Exception as exc:
        logger.error(f"[CELERY] Pipeline task failed for job_id={job_id}: {exc}")

        async def log_failure():
            async with get_db_session() as db:
                from sqlalchemy import select
                result = await db.execute(select(Job).where(Job.id == job_id))
                job = result.scalars().first()
                if job:
                    job.status = JobStatus.FAILED
                    job.error = str(exc)
                    await db.commit()

        asyncio.run(log_failure())
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))


@app.task(name="pipeline.run_approved_action")
def run_approved_action_task(job_id: str):
    """
    Triggered only after a recruiter explicitly approves via the dashboard.
    Executes Action phase: email, Linear ticket, Slack, voice call.
    Guards against unapproved execution at the database level.
    """
    import asyncio
    from sqlalchemy import select
    from agents.orchestrator import Orchestrator
    from core.database import get_db_session
    from core.models import Job

    async def execute():
        async with get_db_session() as db:
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalars().first()
            if not job:
                raise ValueError(f"Job {job_id} not found")
            if job.review_status != "approved":
                raise ValueError("Recruiter approval is required before executing outreach actions")
            payload, evaluation, trace_id = job.payload, job.evaluation, job.trace_id

        await Orchestrator().execute_approved_action(job_id, payload, evaluation, trace_id)

    return asyncio.run(execute())
