# backend/api/ws.py
# WebSocket endpoint for real-time dashboard updates

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.websocket_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep-alive loop
    except WebSocketDisconnect:
        manager.disconnect(websocket)
