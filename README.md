# 🤖 GeniusAI: Autonomous Recruiting Pipeline

[![Database: Supabase](https://img.shields.io/badge/Database-Supabase-green?style=for-the-badge)](https://supabase.com)
[![AI: Groq Llama 3](https://img.shields.io/badge/AI-Groq_Llama_3-orange?style=for-the-badge)](https://groq.com)
[![Voice: Vapi](https://img.shields.io/badge/Voice_AI-Vapi.ai-purple?style=for-the-badge)](https://vapi.ai)

A production-grade, multi-agent autonomous pipeline that handles candidate research, evaluation, and outreach end-to-end. Built for high-scale recruiting teams who need deep reasoning, real-time observability, and **Live AI Voice Screening**.

---

## 🌟 Hackathon-Ready Features

- **🎙️ Interactive Voice AI (Vapi.ai)**: Integrated Web-Call SDK allowing recruiters to speak live with an AI Assistant that has been dynamically injected with the candidate's scraped GitHub technical profile.
- **🛡️ Smart Gatekeeper Logic**: The dashboard actively filters candidates. The "Talk to AI" option only unlocks if the AI Reasoning Agent determines the candidate is a `STRONG_YES` or `SOFT_YES`.
- **🕵️‍♂️ Multi-Agent Collaboration**: Three specialized agents (Research, Reasoning, Action) working in tandem via Celery queues.
- **🥗 "Token Diet" Research**: Optimized GitHub API scraping logic that extracts high-value technical context while staying strictly under LLM rate limits.
- **⚡ Real-Time Dashboard**: A premium, glassmorphism UI built in React/Vite that streams the AI's "internal monologue" and decisions live via WebSockets.
- **🚀 One-Click Launch**: Includes a `start_everything.ps1` script to instantly boot the Backend, Frontend, and Celery Workers simultaneously for flawless live demos.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Python, FastAPI, Celery, SQLAlchemy, WebSockets |
| **Frontend** | React, Vite, Vanilla CSS (Glassmorphism & Micro-animations) |
| **AI Models** | Groq (Llama-3.1-8b-instant / 70b-versatile) |
| **Database** | Supabase (PostgreSQL), Redis (Upstash) |
| **Voice AI** | Vapi Web SDK |
| **Tools** | Tavily (Search), GitHub API, Resend (Email Outreach) |

---

## 🚀 Quick Start (Demo Mode)

The fastest way to launch the entire stack for a live demo:

1. **Configure Environment**: Ensure your `.env` is populated in the `/backend` folder (Groq, Vapi, Supabase, Redis).
2. **Run the Master Script**: 
   Right-click `start_everything.ps1` in the root folder and select **"Run with PowerShell"**.
   *(This will automatically launch the Backend, Frontend, and Celery Workers in separate windows).*
3. **Open Dashboard**: Navigate to `http://localhost:3000`.

### 🎯 How to Trigger a Candidate Evaluation
1. Open `backend/trigger_payload.json` and customize the candidate's details.
2. In a new terminal inside the `/backend` folder, run:
   ```bash
   python trigger_demo.py
   ```
3. Watch the dashboard populate live!

---

## 🧠 Agent Architecture

1. **Research Agent**: Uses Tavily and GitHub APIs to build a 360° profile of the candidate, optimizing for token limits.
2. **Reasoning Agent**: Evaluates the candidate against a custom Job Description using deep LLM reflection and outputs a scorecard.
3. **Action Agent**: Executes final decisions—drafting personalized outreach emails and initiating the Voice AI handoff logic.

---

## 🤝 The "Talk to AI" Workflow
1. The Research Agent completes its GitHub analysis.
2. If the Reasoning Agent approves the candidate, the dashboard unlocks the **🎙️ Talk to AI** button.
3. Clicking the button initiates a browser-based Vapi Web-Call.
4. The candidate's `technical_summary` is injected into the Vapi Assistant's context, allowing for a highly specific, technical voice interview.
