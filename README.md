# GeniusAI: Evidence-Based Recruiting Copilot

[![Database: PostgreSQL / Supabase](https://img.shields.io/badge/Database-PostgreSQL_%2B_pgvector-green?style=for-the-badge)](https://supabase.com)
[![AI: Groq Llama 3](https://img.shields.io/badge/AI-Groq_Llama_3-orange?style=for-the-badge)](https://groq.com)
[![Voice: Vapi](https://img.shields.io/badge/Voice_AI-Vapi.ai-purple?style=for-the-badge)](https://vapi.ai)

GeniusAI is a human-in-the-loop **Recruiting Copilot** that helps engineering hiring teams research candidate technical artifacts, produce transparent evidence-grounded scorecards, and prepare personalized outreach.

> **Product Contract**: The AI prepares evidence, explanations, and recommended actions. A human recruiter reviews and approves consequential actions before any email, ticket, Slack alert, or voice call is initiated.

---

## Core Capabilities

- **Evidence-Based Research**: Gathers verified public technical artifacts from GitHub (repositories, language usage, commit patterns) and permitted public sources, recording data quality and confidence.
- **Transparent, Grounded Scorecards**: Evaluates candidates against role-specific rubrics with concrete evidence citations (`quote`, `locator`, `source_type`) and explicit notes describing missing or unverified evidence rather than penalizing candidates for thin public profiles.
- **Human Recruiter Approval Gate**: AI analysis automatically pauses at the `awaiting_review` workflow state. Recruiters approve, edit, or reject the prepared outreach before any side effect is triggered.
- **Safe Outreach Preparation**: `DRY_RUN=True` is enabled by default. Candidate communications are prepared for the candidate's actual submitted email address without test mailbox redirects.
- **Semantic Candidate Search (RAG)**: Recruiters can semantically query the talent pool using dense vector embeddings generated via `sentence-transformers` and stored in PostgreSQL (`pgvector`) with an automated SQLite fallback for local evaluation.
- **Consent-Aware Voice Screening**: Interactive voice screening requires explicit candidate consent (`voice_consent`), is disabled for automated execution by default, and is recruiter-initiated.
- **Direct Resume PDF Ingestion**: Built-in resume extractor automatically parses candidate identity, GitHub links, and skills directly from PDF uploads.

---

## System Architecture

```
Signed Webhook / Resume Upload
              │
              ▼
    FastAPI (202 Accepted)
              │
              ▼
   Celery Worker (Redis Queue)
              │
              ▼
   Orchestrator Pipeline:
     1. ResearchAgent (GitHub API + Tavily Search)
     2. ReasoningAgent (Llama-3.3-70B + Evidence Linking)
              │
              ▼
    [AWAITING_REVIEW GATE] ─── Recruiter Dashboard
              │
      (Recruiter Approves)
              │
              ▼
     3. ActionAgent (Resend Email + Linear + Slack + Vapi Call)
              │
              ▼
           COMPLETE
```

| Layer | Technology |
| :--- | :--- |
| **Backend API** | Python, FastAPI, SQLAlchemy (Async), WebSockets |
| **Task Queue** | Celery + Upstash Redis (TLS) |
| **Persistence** | PostgreSQL (`pgvector`) / SQLite local demo fallback |
| **AI Inference** | Groq (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`) |
| **Embedding Model** | `all-MiniLM-L6-v2` (384-dimensional dense vectors) |
| **Observability** | Omium Hierarchical Causal Tracing (`omium` SDK) |
| **Frontend UI** | React, Vite, Glassmorphic CSS |
| **Integrations** | GitHub REST API, Tavily, Resend, Linear, Slack, Vapi |

---

## Safety & Fairness Controls

1. **Assisted Decision-Making**: The copilot provides recommendations (e.g. *Advance to Technical Screen*, *Review Further*, *Decline*), not unilateral employment decisions.
2. **No Protected Attributes**: Prompts and validation strictly prohibit evaluating or inferring age, gender, race, ethnicity, religion, disability, health, family status, or political views.
3. **Missing Evidence vs Negative Signals**: Candidates with private or thin public GitHub profiles are flagged with `insufficient_data` and routed to `Review Further` rather than being rejected.
4. **Mandatory Webhook Signatures**: Production webhooks enforce HMAC-SHA256 signature verification (`X-Webhook-Signature`).
5. **Idempotency Guarantee**: All outbound actions use database-enforced idempotency keys (`ActionLog` table) to prevent duplicate outreach.

---

## Local Setup & Quick Start

1. **Environment Configuration**:
   Ensure `.env` in the `backend/` directory is populated:
   ```ini
   HUMAN_REVIEW_REQUIRED=True
   DRY_RUN=True
   ALLOW_AUTOMATED_VOICE_CALLS=False
   REQUIRE_WEBHOOK_SIGNATURE=True
   WEBHOOK_SECRET=change-this-secret-now
   ```

2. **Launch All Services**:
   Run the PowerShell starter script from the root directory:
   ```powershell
   .\start_everything.ps1
   ```
   This boots:
   - FastAPI Backend (`http://localhost:8000`)
   - Vite React Frontend (`http://localhost:3000`)
   - Celery Worker (asynchronous agent execution)

3. **Ingest a Candidate**:
   - Open `http://localhost:3000` in your browser.
   - Click **📄 Ingest Candidate / Resume** to upload a PDF resume or enter candidate details.
   - Alternatively, trigger the signed demo runner:
     ```bash
     cd backend
     python trigger_demo.py
     ```
   - Watch the copilot research the candidate and pause at the **Recruiter Review Required** gate.
   - Review the evidence-linked scorecard, edit the email draft, and click **Approve & Send Actions**!
