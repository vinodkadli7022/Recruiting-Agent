# backend/core/models.py
# ============================================================
# STEP 3: Database Models — with corrections applied
# ============================================================
# Changes from original prompt:
#   1. Added explicit `email` and `role_applied` columns to Job
#      for simplified deduplication (no JSON-path tricks on SQLite)
#   2. Added UniqueConstraint on ActionLog.idempotency_key
#   3. Using datetime.utcnow via server_default where possible
# ============================================================

from sqlalchemy import (
    Column,
    String,
    DateTime,
    JSON,
    Float,
    Text,
    Enum as SAEnum,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime
import enum


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    RECEIVED = "received"
    RESEARCHING = "researching"
    REASONING = "reasoning"
    ACTING = "acting"
    COMPLETE = "complete"
    FAILED = "failed"


class DecisionType(str, enum.Enum):
    STRONG_YES = "STRONG_YES"
    SOFT_YES = "SOFT_YES"
    NO = "NO"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    status = Column(SAEnum(JobStatus), default=JobStatus.RECEIVED)

    # --- DEDUP FIX: explicit columns instead of JSON-path queries ---
    email = Column(String, index=True, nullable=False)
    role_applied = Column(String, index=True, nullable=False)

    payload = Column(JSON)                           # Raw incoming webhook data
    research_result = Column(JSON)                   # What research agent found
    evaluation = Column(JSON)                        # Reasoning agent's full evaluation
    decision = Column(SAEnum(DecisionType))          # Final decision
    outcome = Column(JSON)                           # What actions were taken
    error = Column(Text)                             # Error message if failed
    trace_id = Column(String)                        # Omium trace ID

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime)


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id = Column(String, primary_key=True)
    job_id = Column(String, index=True)
    agent_name = Column(String)       # "orchestrator" | "research" | "reasoning" | "action"
    step_name = Column(String)        # e.g. "github_lookup", "send_email"
    status = Column(String)           # "running" | "complete" | "failed"
    input_data = Column(JSON)
    output_data = Column(JSON)
    duration_ms = Column(Float)
    error = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class ActionLog(Base):
    __tablename__ = "action_log"

    id = Column(String, primary_key=True)
    job_id = Column(String, index=True)
    action_type = Column(String)           # "send_email" | "create_ticket" | "send_slack"
    idempotency_key = Column(String, unique=True)  # Prevents double execution
    params = Column(JSON)
    result = Column(JSON)
    status = Column(String)                # "pending" | "complete" | "failed"
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_action_log_idempotency_key"),
    )
