import asyncio
from core.database import async_engine
from sqlalchemy import text

async def main():
    async with async_engine.begin() as conn:
        print("Truncating all tables...")
        await conn.execute(text("TRUNCATE TABLE action_log, agent_steps, jobs RESTART IDENTITY CASCADE"))
        
        # Verify
        r1 = await conn.execute(text("SELECT COUNT(*) FROM jobs"))
        r2 = await conn.execute(text("SELECT COUNT(*) FROM agent_steps"))
        r3 = await conn.execute(text("SELECT COUNT(*) FROM action_log"))
        print(f"jobs: {r1.scalar()} rows")
        print(f"agent_steps: {r2.scalar()} rows")
        print(f"action_log: {r3.scalar()} rows")
        print("DATABASE WIPED CLEAN.")

asyncio.run(main())
