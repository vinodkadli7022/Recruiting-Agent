# backend/core/database.py
# ============================================================
# ASYNC DATABASE REWRITE — Critical correction from original prompt
# ============================================================
# The original code used synchronous `next(get_db())` inside async
# functions which leaks connections and crashes under load.
#
# This module provides:
#   - async_engine: AsyncEngine for SQLAlchemy
#   - AsyncSessionLocal: async session factory
#   - get_db(): async generator for FastAPI dependency injection
#   - get_db_session(): async context manager for use in agents/workers
# ============================================================

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from core.config import settings

from sqlalchemy.pool import NullPool

# Create async engine
_connect_args = {}
_pool_args = {}

if settings.DATABASE_URL.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}
elif "supabase.com" in settings.DATABASE_URL:
    # Supabase/PgBouncer requires disabling prepared statement cache
    _connect_args = {"statement_cache_size": 0}
    # Use NullPool to prevent "another operation in progress" errors with asyncpg + pgbouncer
    _pool_args = {"poolclass": NullPool}

async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=_connect_args,
    **_pool_args
)

# Session factory — produces AsyncSession instances
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    """
    FastAPI dependency: yields an AsyncSession.
    Usage in route handlers:
        async def my_route(db: AsyncSession = Depends(get_db)):
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


class get_db_session:
    """
    Async context manager for use OUTSIDE of FastAPI routes
    (e.g., inside Celery tasks, agent code, broadcast helpers).

    Usage:
        async with get_db_session() as db:
            result = await db.execute(select(Job))
    """

    async def __aenter__(self) -> AsyncSession:
        self._session = AsyncSessionLocal()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            await self._session.rollback()
        await self._session.close()
