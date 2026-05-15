# 🤖 Autonomous Recruiting Pipeline (Genius Recruiter)

[![Omium Traced](https://img.shields.io/badge/Omium-Traced-blueviolet?style=for-the-badge)](https://omium.ai)
[![Database: Supabase](https://img.shields.io/badge/Database-Supabase-green?style=for-the-badge)](https://supabase.com)
[![AI: Groq Llama 3](https://img.shields.io/badge/AI-Groq_Llama_3-orange?style=for-the-badge)](https://groq.com)

A production-grade, multi-agent autonomous pipeline that handles candidate research, evaluation, and outreach end-to-end. Built for high-scale recruiting teams who need deep reasoning and verifiable traces.

---

##  Key Features

- **Multi-Agent Collaboration**: Three specialized agents (Research, Reasoning, Action) working in tandem.
- **Deep GitHub Analysis**: Automatically pulls and analyzes a candidate's top repositories to verify technical depth.
- **Real-World Side Effects**: Sends personalized emails via **Resend** and notifications via **Slack**.
- **Production Architecture**: Built on **FastAPI**, **Celery**, and **Redis** for asynchronous, long-running task handling.
- **Full Observability**: Integrated with the **Omium SDK** for real-time AI tracing and decision transparency.
- **Cloud Persistence**: Powered by **Supabase (PostgreSQL)** for reliable, scalable data storage.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Python, FastAPI, Celery, SQLAlchemy |
| **Frontend** | React, Vite, TailwindCSS (Vanilla Optimized) |
| **AI Models** | Groq (Llama 3.1 8B / 70B) |
| **Database** | Supabase (PostgreSQL), Redis (Upstash) |
| **Observability** | Omium SDK |
| **Tools** | Tavily (Search), GitHub API, Resend (Email), Slack API |

---

##  Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 18+
- Redis (Local or Upstash)

### 2. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

### 4. Environment Variables
Create a `.env` file in the `backend/` directory based on `.env.example`:
```env
GROQ_API_KEY=your_key
TAVILY_API_KEY=your_key
GITHUB_TOKEN=your_token
RESEND_API_KEY=your_key
SLACK_WEBHOOK_URL=your_url
OMIUM_API_KEY=your_key
DATABASE_URL=postgresql+asyncpg://... (Supabase)
REDIS_URL=rediss://... (Upstash)
```

---

##  Agent Architecture

1. **Research Agent**: Uses Tavily and GitHub APIs to build a 360° profile of the candidate.
2. **Reasoning Agent**: Evaluates the candidate against a custom Job Description using deep LLM reflection.
3. **Action Agent**: Executes final decisions—drafting personalized outreach or filing internal reports.

---

##  Webhook Trigger
The pipeline is triggered via a POST request to `/webhook/applicant`:
```json
{
  "name": "Candidate Name",
  "email": "candidate@example.com",
  "role_applied": "Software Engineer",
  "github_handle": "username"
}
```

---


