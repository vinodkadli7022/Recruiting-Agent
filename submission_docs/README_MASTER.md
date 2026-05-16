# 🚀 GeniusAI: The Autonomous Recruiting Engine

**Solving the Talent Bottleneck with Multi-Agent Autonomy.**

GeniusAI is a production-grade, multi-agent autonomous pipeline designed to handle the end-to-end lifecycle of technical recruiting. From the moment a candidate applies (via webhook) to the final AI-powered voice screening and outreach, the system operates with zero human intervention.

---

## 🏆 Hackathon Highlights
- **110% Score Ready**: Core AXES covered + 10% Omium Tracing Bonus.
- **Deep Reasoning**: Powered by Llama-3.3-70B for unbiased, merit-based evaluation.
- **Real Side-Effects**: Slack notifications, Linear tickets, Resend emails, and Vapi Voice calls.
- **Semantic RAG**: Uses 384-dim vector embeddings for high-fidelity candidate matching.
- **Omium Traced**: Every agent decision and tool call is verifiable via the Omium Dashboard.

---

## 🛠️ Technical Architecture

### **The Multi-Agent Orchestration**
Our system follows a specialized "Research -> Reasoning -> Action" pattern, managed by a central **Async Orchestrator**.

1.  **🔍 Research Agent**: 
    - **Tools**: GitHub API, Tavily Web Search.
    - **Task**: Builds a 360-degree digital footprint of the candidate.
2.  **🧠 Reasoning Agent**: 
    - **LLM**: Llama-3.3-70B-Versatile.
    - **Task**: Decomposes the research data, matches it against job requirements, and makes a non-biased hiring decision.
3.  **🎬 Action Agent**: 
    - **Tools**: Resend (Email), Slack, Linear, Vapi (Voice).
    - **Task**: Executes real-world outcomes based on the hiring decision.

### **The Stack**
- **Framework**: FastAPI (Async)
- **Task Queue**: Celery + Redis (Asynchronous execution)
- **Database**: Supabase (PostgreSQL) + SQLAlchemy ORM
- **Intelligence**: Groq (Llama-3.3-70B)
- **Observability**: Omium SDK (Causal Linking enabled)

---

## 📈 Omium Observability
Every meaningful step is instrumented.
- **Project Name**: `Recruiting-Agent`
- **Tracing Bonus**: Causal linking (parent-child spans) is implemented across all agent boundaries.
- **Verifiable**: Judges can view the execution tree in the dashboard to see exactly why the AI made a specific decision.

---

## ⚡ Quickstart (Judge's Guide)

To produce a **Green Demo Run** on a clean machine:

### 1. Environment Setup
```bash
# Clone and install dependencies
pip install -r backend/requirements.txt
pip install omium
```

### 2. Authentication
Ensure your `.env` file contains:
- `GROQ_API_KEY`
- `OMIUM_API_KEY`
- `VAPI_API_KEY`
- `RESEND_API_KEY`
- `DATABASE_URL` (Supabase)

### 3. Start the Engine
```powershell
.\start_everything.ps1
```

### 4. Trigger the Autonomous Pipeline
```bash
cd backend
python trigger_demo.py
```

---

## 📄 License
MIT - Built for the Autonomous Agent Hackathon 2026.
