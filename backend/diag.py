import asyncio
from core.database import get_db_session
from core.models import Job
from sqlalchemy import select

async def check():
    async with get_db_session() as db:
        res = await db.execute(select(Job).limit(5))
        jobs = res.scalars().all()
        for j in jobs:
            print(f"ID: {j.id} | PAYLOAD: {j.payload}")

if __name__ == "__main__":
    asyncio.run(check())
