# GeniusAI: Autonomous Recruiting Pipeline

[![Database: Supabase](https://img.shields.io/badge/Database-Supabase-green?style=for-the-badge)](https://supabase.com)
[![AI: Groq Llama 3](https://img.shields.io/badge/AI-Groq_Llama_3-orange?style=for-the-badge)](https://groq.com)
[![Voice: Vapi](https://img.shields.io/badge/Voice_AI-Vapi.ai-purple?style=for-the-badge)](https://vapi.ai)

A production-grade, multi-agent autonomous pipeline designed to handle candidate research, evaluation, and outreach end-to-end. Built for high-scale recruiting teams requiring deep reasoning, real-time observability, and live AI voice screening capabilities.

---

## Core Capabilities

- **Interactive Voice AI**: Integrated Web-Call SDK allowing recruiters to initiate live conversations with an AI Assistant. The assistant is dynamically provisioned with the candidate's scraped technical profile and GitHub history.
- **Smart Gatekeeper Logic**: The dashboard actively filters candidates, restricting the voice screening functionality exclusively to candidates evaluated as a `STRONG_YES` or `SOFT_YES` by the Reasoning Agent.
- **Multi-Agent Orchestration**: Three specialized agents (Research, Reasoning, Action) operating asynchronously in tandem via Celery queues.
- **Optimized Data Ingestion**: Advanced GitHub API scraping logic designed to extract high-value technical context while strictly adhering to LLM rate limits and token constraints.
- **Real-Time Telemetry Dashboard**: A high-performance UI built in React/Vite that streams the AI's internal reasoning, state transitions, and evaluation metrics live via WebSockets.
- **Automated Deployment**: Includes deployment scripts for rapid provisioning of the Backend, Frontend, and Celery Worker nodes.

---

## Technical Architecture

| Layer | Technology Stack |
| :--- | :--- |
| **Backend** | Python, FastAPI, Celery, SQLAlchemy, WebSockets |
| **Frontend** | React, Vite, Vanilla CSS |
| **AI Inference** | Groq (Llama-3.1-8b-instant / 70b-versatile) |
| **Data Persistence** | Supabase (PostgreSQL), Redis (Upstash) |
| **Voice Synthesis** | Vapi Web SDK |
| **Integrations** | Tavily Search, GitHub API, Resend Email API |

---

## System Initialization

To deploy the system locally for evaluation:

1. **Configure Environment**: Ensure your `.env` is populated in the `/backend` directory with valid credentials for Groq, Vapi, Supabase, and Redis.
2. **Execute Initialization Script**: 
   Run the `start_everything.ps1` script via PowerShell from the root directory. This will concurrently launch the API service, the client application, and the Celery worker pool.
3. **Access Interface**: Navigate to `http://localhost:3000`.

### Triggering a Candidate Evaluation
1. Modify `backend/trigger_payload.json` with the target candidate's parameters.
2. Execute the test client from the `/backend` directory:
   ```bash
   python trigger_demo.py
   ```
3. Monitor the evaluation pipeline live via the telemetry dashboard.

---

## Agent Topology

1. **Research Agent**: Utilizes Tavily and GitHub APIs to construct a comprehensive profile of the candidate, strictly managing context windows.
2. **Reasoning Agent**: Evaluates the compiled profile against custom Job Descriptions utilizing deep LLM reflection to generate a structured scorecard.
3. **Action Agent**: Executes the final pipeline state—dispatching personalized outreach and provisioning the candidate's data for the Voice AI module.

---

## Interactive Voice Workflow
1. The Research Agent finalizes data extraction and aggregation.
2. Upon approval from the Reasoning Agent, the dashboard provisions the Voice Screening interface.
3. Activating the interface establishes a browser-based Web-Call via Vapi.
4. The candidate's `technical_summary` is injected into the Vapi Assistant's context window, enabling a highly specific, dynamically generated technical interview.
