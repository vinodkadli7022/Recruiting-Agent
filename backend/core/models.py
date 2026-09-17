# backend/core/models.py
# ============================================================
# Database Domain Models
# ============================================================

from sqlalchemy import (
    Column,
    String,
    DateTime,
    JSON,
    Float,
    Text,
    Boolean,
    Enum as SAEnum,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime
import enum
from core.config import settings

# Use pgvector for PostgreSQL; plain JSON list for SQLite local demo
if settings.DATABASE_URL.startswith("sqlite"):
    EmbeddingType = JSON
else:
    from pgvector.sqlalchemy import Vector
    EmbeddingType = Vector(384)


class Base(DeclarativeBase):
    pass


class JobStatus(str, enum.Enum):
    RECEIVED        = "received"
    RESEARCHING     = "researching"
    REASONING       = "reasoning"
    AWAITING_REVIEW = "awaiting_review"   # Human gate: AI done, recruiter must approve
    ACTING          = "acting"
    COMPLETE        = "complete"
    FAILED          = "failed"


class DecisionType(str, enum.Enum):
    STRONG_YES = "STRONG_YES"
    SOFT_YES   = "SOFT_YES"
    NO         = "NO"


class Job(Base):
    __tablename__ = "jobs"

    id          = Column(String, primary_key=True)
    status      = Column(SAEnum(JobStatus), default=JobStatus.RECEIVED)

    # Explicit indexed columns for deduplication queries
    email        = Column(String, index=True, nullable=False)
    role_applied = Column(String, index=True, nullable=False)

    payload          = Column(JSON)           # Raw incoming webhook / resume data
    research_result  = Column(JSON)           # What research agent found
    evaluation       = Column(JSON)           # Reasoning agent's full scorecard
    decision         = Column(SAEnum(DecisionType))
    outcome          = Column(JSON)           # Actions taken after approval
    thoughts         = Column(JSON, default=[])
    error            = Column(Text)
    trace_id         = Column(String)         # Omium trace ID

    # Human-in-the-loop review fields
    review_status = Column(String, default="pending")  # pending | approved | rejected
    reviewed_at   = Column(DateTime)
    reviewed_by   = Column(String)

    # RAG semantic memory — pgvector in production, JSON list in SQLite demo
    semantic_embedding = Column(EmbeddingType)

    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime)


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id          = Column(String, primary_key=True)
    job_id      = Column(String, index=True)
    agent_name  = Column(String)   # orchestrator | research | reasoning | action
    step_name   = Column(String)   # e.g. github_lookup, send_email
    status      = Column(String)   # running | complete | failed
    input_data  = Column(JSON)
    output_data = Column(JSON)
    duration_ms = Column(Float)
    error       = Column(Text)
    created_at  = Column(DateTime, default=datetime.utcnow)


class ActionLog(Base):
    __tablename__ = "action_log"

    id              = Column(String, primary_key=True)
    job_id          = Column(String, index=True)
    action_type     = Column(String)           # send_email | create_ticket | send_slack | voice_call
    idempotency_key = Column(String, unique=True)
    params          = Column(JSON)
    result          = Column(JSON)
    status          = Column(String)           # pending | complete | failed
    created_at      = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_action_log_idempotency_key"),
    )
