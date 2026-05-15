# backend/celery_app.py
# ============================================================
# STEP 6 (stub): Celery Worker Configuration
# ============================================================
# This file is a STUB so that main.py + webhooks.py can import
# run_pipeline_task without crashing. Full implementation comes
# in the next build step.
#
# Corrections applied:
#   1. task_acks_late=True — don't ack until complete
#   2. task_reject_on_worker_lost=True — re-queue if worker crashes
#   3. Async DB usage inside task (via get_db_session context manager)
# ============================================================

import os
import sys
from celery import Celery

# Ensure current directory is in path for local imports
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
    task_acks_late=True,                    # CRITICAL: don't ack until complete
    worker_prefetch_multiplier=1,           # One task per worker at a time
    task_reject_on_worker_lost=True,        # Re-queue if worker crashes
    task_soft_time_limit=300,               # 5 min soft limit
    task_time_limit=360,                    # 6 min hard limit
    broker_connection_timeout=1,            # Fail fast if Redis is down (seconds)
    broker_connection_retry_on_startup=False,  # Don't block startup retrying broker
)


@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    name="pipeline.run",
)
def run_pipeline_task(self, job_id: str, payload: dict):
    """
    The main Celery task. Runs the full pipeline for one job.
    Retries up to 3 times with exponential backoff on failure.
    Survives worker restarts because task_acks_late=True.

    NOTE: Full orchestrator wiring happens in the next build step.
    For now this is a stub that logs receipt.
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
        # Run the async dispatch in the synchronous Celery worker
        asyncio.run(orchestrator.dispatch(job_id, payload))
        logger.info(f"[CELERY] Pipeline task completed for job_id={job_id}")
        
    except Exception as exc:
        logger.error(f"[CELERY] Pipeline task failed for job_id={job_id}: {exc}")
        
        # Log failure to DB using async session
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
        
        # Retry with exponential backoff (Celery handles this)
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))

