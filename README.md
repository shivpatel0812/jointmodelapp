# Joint Model Application

Multi-model LLM workspace: **v1** sends one prompt to several models in parallel and shows each response side by side. Optional **judge** step scores answers and picks a winner via OpenAI JSON mode (`POST /api/evaluate`). **Joint Pipeline** mode runs models sequentially through draft, critique, improve, optional verify, and final answer steps (`POST /api/pipeline`).

## Stack

- **Backend:** FastAPI (`backend/`) — `POST /api/generate` runs OpenAI, Anthropic, and Gemini models concurrently with `asyncio.gather`.
- **Frontend:** Vite + React + TypeScript + Tailwind (`frontend/`) — proxied `/api/*` to the FastAPI server in dev.

## Setup

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set OPENAI_API_KEY, ANTHROPIC_API_KEY, and/or GEMINI_API_KEY (GOOGLE_API_KEY also works for Gemini)
# Optional: JUDGE_MODEL_ID and SYNTHESIS_MODEL_ID (OpenAI models for POST /api/evaluate; default gpt-4o-mini; requires OPENAI_API_KEY)
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Ensure the API is running on port **8000** so the Vite proxy can reach `/api`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness |
| GET | `/api/models` | Registered models and whether each is callable (API key present) |
| POST | `/api/generate` | Body: `{ "prompt": "...", "model_ids": ["gpt-4o-mini", ...] }` — parallel completion |
| POST | `/api/evaluate` | Body: `prompt`, `candidates` (optional `latency_ms`), `failed_attempts`, `include_synthesis` — rubric (incl. evidence & recency), `winner_model_id`, `rationale`, `final_synthesis`, `highlights`, `excluded_failed_summary`. Env: `JUDGE_MODEL_ID`, `SYNTHESIS_MODEL_ID`. |
| POST | `/api/pipeline` | Body: `prompt`, `draft_model_id`, `critic_model_id`, `improver_model_id`, optional `verifier_model_id`, `final_model_id` — returns `final_answer`, status, and a full step trace with per-step latency/errors. |

Omitting `model_ids` uses every model that has a configured key (useful for `curl`).

## Model IDs

Defaults live in `backend/main.py` (`MODEL_REGISTRY`). Adjust IDs to match your provider accounts and quotas.
