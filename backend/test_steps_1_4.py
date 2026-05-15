"""
Test script for Steps 1-4: Infrastructure + Core + FastAPI + Webhooks
Run with: python test_steps_1_4.py  (while uvicorn is running on :8000)
"""
import httpx
import time
import sys

BASE = "http://localhost:8000"
PASS = 0
FAIL = 0

def test(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} -- {detail}")

print("\n=== STEP 1: Health Check ===")
r = httpx.get(f"{BASE}/health", timeout=5)
test("GET /health returns 200", r.status_code == 200)
test("Response has status=ok", r.json().get("status") == "ok", r.text)

print("\n=== STEP 2: Empty Jobs List ===")
r = httpx.get(f"{BASE}/jobs/", timeout=5)
test("GET /jobs/ returns 200", r.status_code == 200)
test("Jobs list is an array", isinstance(r.json(), list), r.text)

print("\n=== STEP 3: Webhook POST (create job) ===")
payload = {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role_applied": "Senior Backend Engineer",
    "github_handle": "octocat",
    "source": "hackathon_test"
}
start = time.time()
r = httpx.post(f"{BASE}/webhook/applicant", json=payload, timeout=10)
elapsed_ms = (time.time() - start) * 1000
test("POST /webhook/applicant returns 202", r.status_code == 202, f"got {r.status_code}: {r.text}")
test("Response has job_id", "job_id" in r.json(), r.text)
test("Response status is accepted", r.json().get("status") == "accepted", r.text)
test(f"Response time < 2000ms (was {elapsed_ms:.0f}ms)", elapsed_ms < 2000)
job_id = r.json().get("job_id", "")
print(f"  -> job_id: {job_id}")

print("\n=== STEP 4: Deduplication Test ===")
r2 = httpx.post(f"{BASE}/webhook/applicant", json=payload, timeout=10)
test("Duplicate POST returns 200", r2.status_code == 200, f"got {r2.status_code}")
test("Status is deduplicated", r2.json().get("status") == "deduplicated", r2.text)
test("Returns same job_id", r2.json().get("job_id") == job_id, r2.text)

print("\n=== STEP 5: Job Appears in List ===")
r = httpx.get(f"{BASE}/jobs/", timeout=5)
jobs = r.json()
test("Jobs list now has 1 entry", len(jobs) == 1, f"got {len(jobs)}")
if jobs:
    test("Job has correct name", jobs[0].get("name") == "Jane Smith", str(jobs[0]))
    test("Job has correct email", jobs[0].get("email") == "jane@example.com")
    test("Job status is received", jobs[0].get("status") == "received")

print("\n=== STEP 6: Job Detail ===")
if job_id:
    r = httpx.get(f"{BASE}/jobs/{job_id}", timeout=5)
    test("GET /jobs/{id} returns 200", r.status_code == 200)
    detail = r.json()
    test("Detail has payload", detail.get("payload") is not None)
    test("Detail has steps array", isinstance(detail.get("steps"), list))
    test("Payload has github_handle", detail.get("payload", {}).get("github_handle") == "octocat")

print("\n=== STEP 7: 404 for Unknown Job ===")
r = httpx.get(f"{BASE}/jobs/nonexistent-id", timeout=5)
test("Unknown job returns 404", r.status_code == 404)

print(f"\n{'='*40}")
print(f"Results: {PASS} passed, {FAIL} failed")
if FAIL > 0:
    sys.exit(1)
print("All Steps 1-4 tests PASSED!\n")
