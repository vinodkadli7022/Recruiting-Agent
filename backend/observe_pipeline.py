import asyncio
import asyncpg
import json

DATABASE_URL = "postgresql://postgres.ijyjrmlpinwntlcmhbnw:%40VKkadli7022@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"

async def observe_logs():
    conn = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    
    try:
        job = await conn.fetchrow("SELECT id, status, decision, error FROM jobs ORDER BY created_at DESC LIMIT 1")
        
        if job:
            print(f"--- JOB ID: {job['id']} ---")
            print(f"STATUS: {job['status']} | DECISION: {job['decision']}")
            print(f"ERROR: {job['error']}")
            
            actions = await conn.fetch("SELECT action_type, status, result FROM action_log WHERE job_id = $1", job['id'])
            print("\n--- ACTIONS EXECUTED ---")
            for a in actions:
                print(f"TYPE: {a['action_type']} | STATUS: {a['status']}")
                print(f"RESULT: {a['result']}\n")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(observe_logs())
