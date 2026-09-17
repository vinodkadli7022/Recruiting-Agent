# backend/core/config.py
# Centralized environment and application settings.
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
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # External Services
    TAVILY_API_KEY: str = ""
    RESEND_API_KEY: str = ""
    SLACK_WEBHOOK_URL: str | None = None

    # Scheduling
    CALENDLY_LINK: str = "https://calendly.com/default/interview"

    GITHUB_TOKEN: str = ""
    OMIUM_API_KEY: str = ""
    LINEAR_API_KEY: str = ""

    # AI Voice (Vapi.ai) — keys stay in backend only, never in frontend source
    VAPI_API_KEY: str = ""
    VAPI_ASSISTANT_ID: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    VAPI_WEB_PUBLIC_KEY: str = ""

    # Security
    WEBHOOK_SECRET: str = ""
    REQUIRE_WEBHOOK_SIGNATURE: bool = True

    # Safety controls — safe defaults, must be explicitly disabled in .env
    HUMAN_REVIEW_REQUIRED: bool = True        # AI pauses for recruiter approval before any outreach
    DRY_RUN: bool = True                      # Emails/tickets are prepared but NOT sent until False
    ALLOW_AUTOMATED_VOICE_CALLS: bool = False  # Voice calls require explicit enablement + consent

    # Database — SQLite for local demo; set to asyncpg+postgresql for production
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
