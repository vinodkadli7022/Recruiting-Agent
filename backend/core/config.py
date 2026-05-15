# backend/core/config.py
# STEP 2: All environment variables centralized here
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """
    All environment variables are loaded here.
    Pydantic validates types and provides defaults where sensible.
    """

    # AI / LLM
    ANTHROPIC_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile" # Default model


    # External Services
    TAVILY_API_KEY: str = ""
    RESEND_API_KEY: str = ""
    SLACK_WEBHOOK_URL: str = ""
    GITHUB_TOKEN: str = ""
    OMIUM_API_KEY: str = ""
    LINEAR_API_KEY: str = ""

    # Security
    WEBHOOK_SECRET: str = "change-this-secret-now"

    # Database — uses async SQLite by default, swap to asyncpg+postgresql in prod
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/pipeline.db"

    # Redis (Celery broker)
    REDIS_URL: str = "redis://redis:6379/0"

    # Frontend
    FRONTEND_URL: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
