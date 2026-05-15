import asyncio
from core.database import async_engine
from sqlalchemy import text

async def main():
    print("Attempting to add 'thoughts' column to 'jobs' table...")
    try:
        async with async_engine.begin() as conn:
            # PostgreSQL specific syntax for JSONB
            await conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thoughts JSONB DEFAULT '[]'::jsonb"))
        print("Success! 'thoughts' column is now live.")
    except Exception as e:
        print(f"Error during migration: {e}")

if __name__ == "__main__":
    asyncio.run(main())
