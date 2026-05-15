import httpx
import asyncio
import json

async def trigger():
    url = "http://localhost:8000/webhook/applicant"
    with open("trigger_payload.json", "r") as f:
        payload = json.load(f)
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, json=payload, timeout=10.0)
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(trigger())
