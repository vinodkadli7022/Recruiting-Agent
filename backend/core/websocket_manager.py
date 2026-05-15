# backend/core/websocket_manager.py
# ============================================================
# WebSocket Connection Manager
# ============================================================
# Correction: all broadcast() calls from agent code MUST be wrapped
# in asyncio.create_task() so a slow/dead client never blocks the pipeline.
# This module provides broadcast() which is safe to fire-and-forget.
# ============================================================

from fastapi import WebSocket
import json
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, data: dict):
        """
        Send data to all connected WebSocket clients.
        Dead connections are silently removed.
        NOTE: Callers in agent code should use:
            asyncio.create_task(manager.broadcast({...}))
        to avoid blocking the pipeline on slow clients.
        """
        if not self.active_connections:
            return
        message = json.dumps(data, default=str)
        dead: set[WebSocket] = set()
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                dead.add(connection)
        self.active_connections -= dead


# Singleton — imported everywhere
manager = ConnectionManager()
