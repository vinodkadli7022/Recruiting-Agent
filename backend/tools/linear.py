# backend/tools/linear.py
# Linear ticket creation integration module

import logging

logger = logging.getLogger(__name__)

async def create_linear_ticket(title: str, description: str, decision: str = None) -> dict:
    """
    Creates a tracking ticket in Linear for the candidate evaluation.
    """
    logger.info(f"Linear Ticket (Mock): {title} | Decision: {decision}")
    return {
        "status": "mocked",
        "ticket_id": "LIN-123",
        "url": "https://linear.app/mock/issue/LIN-123"
    }
