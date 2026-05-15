# backend/tools/search.py
# Tavily web search wrapper

import httpx
import logging
from core.config import settings

logger = logging.getLogger(__name__)

async def tavily_search(query: str, max_results: int = 5) -> dict:
    """
    Performs a web search using the Tavily API.
    Returns a dictionary with results or an error message.
    """
    if not settings.TAVILY_API_KEY:
        logger.warning("TAVILY_API_KEY not set. Returning mock results.")
        return {
            "results": [
                {"title": "Mock Result", "url": "https://example.com", "content": "Tavily API key is missing. This is a mock result for development."}
            ],
            "query": query,
            "mock": True
        }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.TAVILY_API_KEY,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "basic"
                }
            )
            response.raise_for_status()
            data = response.json()
            return {
                "results": [
                    {"title": r.get("title", "No Title"), "url": r.get("url", "#"), "content": r.get("content", "")[:500]}
                    for r in data.get("results", [])
                ],
                "query": query
            }
        except httpx.TimeoutException:
            logger.error(f"Tavily search timed out for query: {query}")
            return {"results": [], "error": "Search timed out", "query": query}
        except Exception as e:
            logger.error(f"Tavily search failed: {e}")
            return {"results": [], "error": str(e), "query": query}
