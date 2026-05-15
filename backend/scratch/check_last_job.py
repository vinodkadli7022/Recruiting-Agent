import asyncio
from core.database import AsyncSessionLocal
from core.models import Job
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).order_by(Job.created_at.desc()))
        job = result.scalars().first()
        
        if job:
            print(f"--- LATEST JOB REPORT ---")
            print(f"ID: {job.id}")
            print(f"NAME: {job.payload.get('name')}")
            print(f"HANDLE: {job.payload.get('github_handle')}")
            print(f"STATUS: {job.status}")
            print(f"ERROR: {job.error}")
            if job.evaluation:
                print(f"DECISION: {job.evaluation.get('decision')}")
                print(f"CONFIDENCE: {job.evaluation.get('confidence_score')}%")
        else:
            print("No jobs found.")

if __name__ == "__main__":
    asyncio.run(main())
