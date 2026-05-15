# backend/tools/linear.py
# Linear ticket creation wrapper — MOCKED for hackathon

import logging

logger = logging.getLogger(__name__)

async def create_linear_ticket(title: str, description: str, decision: str = None) -> dict:
    """
    Mocked for hackathon. Returns a success response without calling any API.
    """
    logger.info(f"Linear Ticket (Mock): {title} | Decision: {decision}")
    return {
        "status": "mocked",
        "ticket_id": "LIN-123",
        "url": "https://linear.app/mock/issue/LIN-123"
    }
