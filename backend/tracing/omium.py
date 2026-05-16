# backend/tracing/omium.py
# ============================================================
# Omium Observability Integration
# ============================================================
# This module provides a unified interface for the Omium Tracing SDK,
# enabling real-time monitoring and causal linking of multi-agent
# execution paths.
# ============================================================

import os
import uuid
import logging
from contextlib import contextmanager

try:
    import omium
    OMIUM_AVAILABLE = True
except ImportError:
    OMIUM_AVAILABLE = False

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
        if OMIUM_AVAILABLE:
            try:
                # The SDK reads OMIUM_API_KEY from environment automatically
                # but we can also pass it explicitly if needed.
                omium.init(project="Recruiting-Agent", api_key=api_key)
                self._initialized = True
                logger.info("[Omium] Official SDK initialized for project 'Recruiting-Agent'.")
            except Exception as e:
                logger.error(f"[Omium] Failed to initialize official SDK: {e}")
        else:
            logger.info("[Omium] Tracing is currently disabled (SDK not found).")

    def start_trace(self, name: str, metadata: dict = None) -> str:
        """Bridge for starting a trace."""
        logger.debug(f"[Omium] start_trace called: {name}")
        return f"trace_{uuid.uuid4().hex[:8]}"

    @contextmanager
    def span(self, name: str, parent_id: str = None, **kwargs):
        """Context manager bridging to official Omium tracing with parent linking."""
        if self._initialized and OMIUM_AVAILABLE:
            try:
                # Pass the parent_id to the SDK if supported
                with omium.trace(name, parent_id=parent_id):
                    yield
            except Exception:
                # Fallback if their context manager has a different signature
                yield
        else:
            yield

    @contextmanager
    def trace(self, name: str, **kwargs):
        """Context manager bridging to official Omium tracing."""
        trace_id = self.start_trace(name, kwargs)
        if self._initialized and OMIUM_AVAILABLE:
            try:
                with omium.trace(name):
                    yield trace_id
            except Exception:
                yield trace_id
        else:
            yield trace_id


# Singleton
tracer = OmiumTracer()

# Auto-configure if API key is available
try:
    from core.config import settings
    if settings.OMIUM_API_KEY and "REPLACE_ME" not in settings.OMIUM_API_KEY:
        tracer.configure(settings.OMIUM_API_KEY)
except Exception:
    pass
