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
from tracing.omium import tracer
from tools.slack import send_slack_alert

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self):
        self.research_agent = ResearchAgent()
        self.reasoning_agent = ReasoningAgent()
        self.action_agent = ActionAgent()
    
    async def dispatch(self, job_id: str, payload: Dict[str, Any]):
        """
        Main entry point for the pipeline. Coordinates all specialized agents.
        """
        async with get_db_session() as db:
            from sqlalchemy import select
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalars().first()
            if not job:
                logger.error(f"Job {job_id} not found in database.")
                return

        with tracer.trace("pipeline.full_run", job_id=job_id):
            try:
                # PHASE 1: Research
                await self._update_status(job_id, JobStatus.RESEARCHING)
                research_result = await self._run_with_retry(
                    self.research_agent.run, job_id, payload, phase="research"
                )
                
                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id).values(research_result=research_result)
                    )
                    await db.commit()
                
                # PHASE 2: Reasoning
                await self._update_status(job_id, JobStatus.REASONING)
                evaluation = await self._run_with_retry(
                    self.reasoning_agent.run, job_id, payload, research_result, phase="reasoning"
                )
                
                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id).values(
                            evaluation=evaluation,
                            decision=evaluation.get("decision")
                        )
                    )
                    await db.commit()
                
                # PHASE 3: Action
                await self._update_status(job_id, JobStatus.ACTING)
                outcome = await self._run_with_retry(
                    self.action_agent.run, job_id, payload, evaluation, phase="action"
                )
                
                # Phase 4: Complete
                async with get_db_session() as db:
                    await db.execute(
                        Job.__table__.update().where(Job.id == job_id).values(
                            status=JobStatus.COMPLETE,
                            outcome=outcome,
                            completed_at=datetime.utcnow()
                        )
                    )
                    await db.commit()
                
                # Update UI to green/complete
                await self._update_status(job_id, JobStatus.COMPLETE)
                
                # Final broadcast
                asyncio.create_task(manager.broadcast({
                    "type": "job_complete",
                    "job_id": job_id,
                    "decision": evaluation.get("decision"),
                    "outcome": outcome
                }))
                
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
                
                # CORRECTION: Alert via Slack on failure
                asyncio.create_task(send_slack_alert(f"Pipeline failed for job {job_id}: {str(e)}"))
                
                # Update UI about failure
                asyncio.create_task(manager.broadcast({
                    "type": "status_update",
                    "job_id": job_id,
                    "status": JobStatus.FAILED.value,
                    "error": str(e)
                }))
                raise
    
    async def _run_with_retry(self, fn: Callable, job_id: str, *args, phase: str, attempt: int = 0):
        try:
            return await fn(job_id, *args)
        except AgentFailure as e:
            if attempt < 2:  # Max 2 retries
                wait = 2 ** attempt  # Exponential backoff: 1s, 2s
                logger.warning(f"Phase {phase} failed for job {job_id}, retrying in {wait}s... Error: {e}")
                await asyncio.sleep(wait)
                return await self._run_with_retry(fn, job_id, *args, phase=phase, attempt=attempt+1)
            raise AgentFailure(f"{phase} failed after 3 attempts: {e}")
    
    async def _update_status(self, job_id: str, status: JobStatus):
        async with get_db_session() as db:
            await db.execute(
                Job.__table__.update().where(Job.id == job_id).values(status=status)
            )
            await db.commit()
        
        # CORRECTION: Non-blocking broadcast
        asyncio.create_task(manager.broadcast({
            "type": "status_update", 
            "job_id": job_id, 
            "status": status.value
        }))
