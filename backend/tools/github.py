# backend/tools/github.py
# GitHub API wrapper

import httpx
import logging
from core.config import settings

logger = logging.getLogger(__name__)

async def get_github_profile(username: str) -> dict:
    """
    Fetches a GitHub user's profile, repositories, and activity.
    Uses the GITHUB_TOKEN if available for higher rate limits.
    """
    headers = {}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"token {settings.GITHUB_TOKEN}"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # 1. Fetch User Profile
            user_resp = await client.get(f"https://api.github.com/users/{username}", headers=headers)
            if user_resp.status_code == 404:
                return {"found": False, "username": username}
            user_resp.raise_for_status()
            user = user_resp.json()
            
            # 2. Fetch Top Repositories (sorted by stars)
            repos_resp = await client.get(
                f"https://api.github.com/users/{username}/repos?sort=stars&per_page=10",
                headers=headers
            )
            repos = repos_resp.json() if repos_resp.status_code == 200 else []
            
            return {
                "found": True,
                "username": username,
                "name": user.get("name"),
                "bio": user.get("bio"),
                "public_repos": user.get("public_repos", 0),
                "followers": user.get("followers", 0),
                "total_stars": sum(r.get("stargazers_count", 0) for r in repos),
                "top_repos": [
                    {
                        "name": r.get("name"),
                        "stars": r.get("stargazers_count"),
                        "language": r.get("language"),
                        "description": r.get("description")
                    }
                    for r in repos[:5]
                ],
                "languages": list(set(r.get("language") for r in repos if r.get("language")))
            }
        except Exception as e:
            logger.error(f"GitHub profile fetch failed for {username}: {e}")
            return {"found": False, "error": str(e), "username": username}
