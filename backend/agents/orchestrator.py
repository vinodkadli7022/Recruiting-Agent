# backend/agents/orchestrator.py
# Orchestrator agent — the brain

import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, Any, Callable

from agents.base import AgentFailure
from agents.research import ResearchAgent
from agents.reasoning import ReasoningAgent
from agents.action import ActionAgent
from core.database import get_db_session
from core.models import Job, JobStatus, DecisionType
from core.websocket_manager import manager
from core.config import settings
from tracing.omium import tracer
from tools.slack import send_slack_alert

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self):
        self.research_agent  = ResearchAgent()
        self.reasoning_agent = ReasoningAgent()
        self.action_agent    = ActionAgent()

    async def dispatch(self, job_id: str, payload: Dict[str, Any]):
        """
        Main entry point. Runs Research → Reasoning → (Human Gate) → Action.
        If HUMAN_REVIEW_REQUIRED is True, execution pauses at awaiting_review
        and resumes only when a recruiter approves via the dashboard.
        """
        async with get_db_session() as db:
            from sqlalchemy import select
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalars().first()
            if not job:
                logger.error(f"Job {job_id} not found in database.")
                return

        with tracer.trace("pipeline.full_run", job_id=job_id) as trace_id:
            try:
                # PHASE 1: Research
                await self._update_status(job_id, JobStatus.RESEARCHING)
                research_result = await self._run_with_retry(
                    self.research_agent.run, job_id, payload,
                    phase="research", parent_trace_id=trace_id
                )

                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id)
                        .values(research_result=research_result)
                    )
                    await db.commit()

                # PHASE 2: Reasoning
                await self._update_status(job_id, JobStatus.REASONING)
                evaluation = await self._run_with_retry(
                    self.reasoning_agent.run, job_id, payload, research_result,
                    phase="reasoning", parent_trace_id=trace_id
                )

                # RAG: Semantic vectorization — stored for similarity search
                from core.vector import get_embedding
                semantic_text = (
                    f"Role: {payload.get('role_applied', '')}. "
                    f"Summary: {evaluation.get('summary', '')}. "
                    f"Strengths: {' '.join(evaluation.get('strengths', []))}."
                )
                embedding = get_embedding(semantic_text)

                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id).values(
                            evaluation=evaluation,
                            decision=evaluation.get("decision"),
                            semantic_embedding=embedding
                        )
                    )
                    await db.commit()

                # HUMAN-IN-THE-LOOP GATE
                # If enabled, pipeline pauses here. No email, ticket, Slack, or call
                # is triggered until a recruiter explicitly approves via the dashboard.
                if settings.HUMAN_REVIEW_REQUIRED:
                    await self._set_review_state(job_id)
                    return  # Worker exits — action phase triggered by recruiter approval

                # PHASE 3: Action (only reached when HUMAN_REVIEW_REQUIRED=False)
                await self.execute_approved_action(job_id, payload, evaluation, trace_id)

            except Exception as e:
                logger.error(f"Pipeline failed for job {job_id}: {e}")
                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id).values(
                            status=JobStatus.FAILED,
                            error=str(e)
                        )
                    )
                    await db.commit()

                await send_slack_alert(f"Pipeline failed for job {job_id}: {str(e)}")
                await manager.broadcast({
                    "type": "status_update",
                    "job_id": job_id,
                    "status": JobStatus.FAILED.value,
                    "error": str(e)
                })
                raise

    async def execute_approved_action(
        self,
        job_id: str,
        payload: Dict[str, Any],
        evaluation: Dict[str, Any],
        parent_trace_id: str = None
    ):
        """
        Runs the Action phase. Called directly by the orchestrator (if no review required)
        or by the run_approved_action_task Celery task after recruiter approval.
        """
        await self._update_status(job_id, JobStatus.ACTING)
        outcome = await self._run_with_retry(
            self.action_agent.run, job_id, payload, evaluation,
            phase="action", parent_trace_id=parent_trace_id
        )

        async with get_db_session() as db:
            await db.execute(
                Job.__table__.update().where(Job.id == job_id).values(
                    status=JobStatus.COMPLETE,
                    review_status="approved",
                    outcome=outcome,
                    completed_at=datetime.utcnow()
                )
            )
            await db.commit()

        await manager.broadcast({
            "type": "job_complete",
            "job_id": job_id,
            "status": JobStatus.COMPLETE.value,
            "decision": evaluation.get("decision"),
            "evaluation": evaluation,
            "outcome": outcome
        })
        return outcome

    async def _set_review_state(self, job_id: str):
        """Pauses pipeline and notifies the dashboard that recruiter review is needed."""
        async with get_db_session() as db:
            await db.execute(
                Job.__table__.update().where(Job.id == job_id).values(
                    status=JobStatus.AWAITING_REVIEW,
                    review_status="pending"
                )
            )
            await db.commit()

        await manager.broadcast({
            "type": "review_required",
            "job_id": job_id,
            "status": JobStatus.AWAITING_REVIEW.value,
            "message": "AI evaluation is ready. No outreach has been sent. Recruiter approval required."
        })

    async def _run_with_retry(self, fn: Callable, job_id: str, *args, phase: str, attempt: int = 0, **kwargs):
        try:
            return await fn(job_id, *args, **kwargs)
        except AgentFailure as e:
            if attempt < 2:
                wait = 2 ** attempt  # 1s then 2s
                logger.warning(f"Phase {phase} failed for job {job_id}, retrying in {wait}s... Error: {e}")
                await asyncio.sleep(wait)
                return await self._run_with_retry(fn, job_id, *args, phase=phase, attempt=attempt + 1, **kwargs)
            raise AgentFailure(f"{phase} failed after 3 attempts: {e}")

    async def _update_status(self, job_id: str, status: JobStatus):
        async with get_db_session() as db:
            await db.execute(
                Job.__table__.update().where(Job.id == job_id).values(status=status)
            )
            await db.commit()

        await manager.broadcast({
            "type": "status_update",
            "job_id": job_id,
            "status": status.value
        })
