# GeniusAI: Technical Architecture and Autonomous Workflow Writeup

## 1. Problem Statement: The Talent Identification Bottleneck
Technical recruiting is currently broken. Teams either rely on low-fidelity automated keyword filters that miss high-potential talent, or they spend thousands of human hours manually reviewing GitHub profiles and LinkedIn portfolios. 

**GeniusAI** solves this by providing an **End-to-End Autonomous Pipeline** that treats recruiting like an engineering CI/CD pipeline. By automating the deep research and reasoning phases, we allow hiring teams to focus only on the final interview, knowing that every candidate reaching them has already been thoroughly vetted, scored, and even preliminary-screened via AI voice.

---

## 2. Agent Architecture: Modular Multi-Agent Orchestration
We moved away from a single "Linear Chain" prompt and instead implemented a **Hub-and-Spoke Orchestration** model.

### **The Orchestrator (The Brain)**
The `Orchestrator` manages the state machine and causal tracing. It ensures that data flows correctly from research to reasoning without "hallucination leak." It handles retries and ensures the pipeline is long-running and crash-safe by persisting state in **Supabase**.

### **Specialized Worker Agents**
- **Research Agent**: Acts as the "Digital Detective." It uses a tool-calling loop to interact with the GitHub REST API and Tavily Search. It doesn't just pull data; it looks for specific evidence of technical excellence (PR comments, repo stars, social proof).
- **Reasoning Agent**: Acts as the "Technical Lead." Using Llama-3.3-70B, it performs **Deep Reasoning** to cross-reference research findings against the job description. It generates a multi-dimensional scorecard (Technical Fit, Growth Trajectory, Communication).
- **Action Agent**: Acts as the "Recruiting Coordinator." It executes side-effects like creating Linear tickets for tracking and initiating **Vapi.ai** voice screening calls for high-scoring candidates.

---

## 3. Tool Surface & Side-Effects
A core requirement for this track was "Real Work." GeniusAI produces verifiable real-world outcomes:
- **Linear**: Automatically generates "Hire Candidate" tickets for tracking.
- **Vapi**: Triggers real-time AI voice calls to the candidate's phone for initial screening.
- **Resend**: Drafts and sends personalized, context-aware outreach emails.
- **Slack**: Provides live engineering alerts for the hiring team.
- **Semantic RAG**: Every evaluation is vectorized using `sentence-transformers` and stored in Supabase for semantic retrieval across the entire talent pool.

---

## 4. True Autonomy in Practice
Autonomy is achieved through **Asynchronous Task Orchestration (Celery + Redis)**. 
- **Non-blocking**: When a webhook fires, the API responds instantly with `202 Accepted`, and the work moves to a background worker.
- **Self-Healing**: The Orchestrator handles agent failures and API rate limits with exponential backoff.
- **Zero-Steering**: The decision to "Hire" or "Reject" is made by the Reasoning Agent based on the evidence collected, not a pre-written script.

---

## 5. Observability with Omium
To secure the **Bonus Track**, we instrumented the entire workflow using the Omium SDK. 
- **Causal Linking**: We implemented a hierarchical trace structure. Every tool call and sub-agent step is linked back to the original `job_id` and parent span. 
- **Verified Decision Making**: The Omium dashboard serves as the "Black Box Recorder," making every step of the AI's thought process transparent and auditable by the judges.

---

## 6. Conclusion: The Engineering Vision
GeniusAI represents a shift from "Chatbots" to "Autonomous Systems." By combining **Llama-3.3-70B**, **Vector Embeddings**, and **Multi-Agent Coordination**, we have built a tool that doesn't just talk about work—it finishes it.
