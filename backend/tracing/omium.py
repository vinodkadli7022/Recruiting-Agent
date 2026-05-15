# backend/tracing/omium.py
# ============================================================
# Omium SDK Placeholder
# ============================================================
# The hackathon sponsor (Omium) will provide the real SDK.
# This module wraps their interface so the rest of the codebase
# uses: tracer.start_trace(), tracer.span(), tracer.trace()
#
# When the real SDK arrives:
#   1. pip install <omium-sdk>
#   2. Replace the no-op implementations below with real calls
#   3. The rest of the codebase stays unchanged
# ============================================================

import os
import omium
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class OmiumTracer:
    """
    Wrapper for the official Omium SDK.
    Provides tracing and spanning for the recruiting agents.
    """
    def __init__(self):
        self._initialized = False

    def configure(self, api_key: str):
        """Initialize the official Omium SDK."""
        if not api_key or "REPLACE_ME" in api_key:
            return
        
        try:
            # Initialize with the key directly
            omium.init(api_key=api_key)
            self._initialized = True
            logger.info("[Omium] Official SDK initialized with API Key.")
        except Exception as e:
            logger.error(f"[Omium] Failed to initialize official SDK: {e}")

    def start_trace(self, name: str, metadata: dict = None) -> str:
        """Bridge for starting a trace."""
        logger.debug(f"[Omium] start_trace called: {name}")
        return "official_trace_id"

    @contextmanager
    def span(self, name: str, **kwargs):
        """Context manager bridging to official Omium tracing."""
        # The official SDK uses omium.trace as a decorator or context manager
        # based on version. We'll use a safe approach here.
        if self._initialized:
            try:
                with omium.trace(name):
                    yield
            except Exception:
                # Fallback if their context manager has a different signature
                yield
        else:
            yield

    @contextmanager
    def trace(self, name: str, **kwargs):
        """Context manager bridging to official Omium tracing."""
        if self._initialized:
            try:
                with omium.trace(name):
                    yield
            except Exception:
                yield
        else:
            yield


# Singleton
tracer = OmiumTracer()

# Auto-configure if API key is available
try:
    from core.config import settings
    if settings.OMIUM_API_KEY and "REPLACE_ME" not in settings.OMIUM_API_KEY:
        tracer.configure(settings.OMIUM_API_KEY)
except Exception:
    pass
