import asyncio
import hashlib
import hmac
import json
import os

import httpx

async def trigger():
    url     = os.getenv("API_URL", "http://localhost:8000") + "/webhook/applicant"
    secret  = os.getenv("WEBHOOK_SECRET", "")

    with open("trigger_payload.json", "r", encoding="utf-8") as f:
        payload = json.load(f)

    body      = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url,
                content=body,
                headers={
                    "Content-Type":       "application/json",
                    "X-Webhook-Signature": signature,
                },
                timeout=10.0,
            )
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(trigger())
