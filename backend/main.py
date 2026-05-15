# backend/main.py
# ============================================================
# STEP 4: FastAPI Main App Entry Point
# ============================================================
# Corrections applied:
#   1. Uses async engine for table creation (run_sync)
#   2. Imports all routers including the missing api/jobs.py
#   3. Adds pydantic-settings to handle .env loading
# ============================================================

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.database import async_engine
from core.models import Base
from api import webhooks, jobs, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create data directory and all tables on startup."""
    os.makedirs("data", exist_ok=True)
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Autonomous Pipeline API",
    description="Multi-agent recruiting pipeline — hackathon build",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhooks.router, prefix="/webhook", tags=["webhooks"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(ws.router, tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "autonomous-pipeline"}
