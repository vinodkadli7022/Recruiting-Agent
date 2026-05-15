import asyncio
from core.database import async_engine
from sqlalchemy import text

async def main():
    async with async_engine.connect() as conn:
        result = await conn.execute(text("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'jobs' 
            ORDER BY ordinal_position
        """))
        rows = result.fetchall()
        print("=== JOBS TABLE COLUMNS ===")
        for row in rows:
            print(f"  {row[0]:30s} {row[1]}")

asyncio.run(main())
