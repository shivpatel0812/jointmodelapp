# Joint Model Application

Multi-model LLM workspace: **v1** sends one prompt to several models in parallel and shows each response side by side. Optional **judge** step scores answers and picks a winner via OpenAI JSON mode (`POST /api/evaluate`). **Joint Pipeline** mode runs models sequentially through draft, critique, improve, optional verify, and final answer steps (`POST /api/pipeline`).

### Image attachments (vision)

- Use **Attachments** under the prompt to add PNG, JPEG, or WebP files (client limits: up to **5** images, **10 MB** each decoded).
- `GET /api/models` includes **`supports_vision`**, **`supported_input_types`**, **`max_images`**, and **`image_notes`** per model (`MODEL_REGISTRY` in `backend/main.py`). Treat the registry as **maintainer-curated**, not guaranteed — confirm multimodal support with each provider before production use.
- **Compare / Synthesize:** Models that do not support vision are **skipped** when images are present (not failed). Response cards show **Images used: N** or **Text only** as appropriate; the judge receives a **`run_attachment_note`** describing who saw images vs who was skipped.
- **Joint pipeline:** If images are attached, the **Draft** model **must** support vision (API returns `400` otherwise). Verify receives pixels only when the verifier model supports vision; otherwise the prompt notes that verification is text-only relative to images.
- **Storage:** Images are sent on the request and **discarded afterward**. Firestore chat messages store **attachment metadata only** (filename, MIME type, size) — not base64 payloads.
  - **TODO:** Upload blobs to **Firebase Storage**, persist `storagePath` / download URL, and lock down access with security rules.

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
| POST | `/api/generate` | Body: `{ "prompt": "...", "model_ids": [...], "images": [{ "file_name", "mime_type", "base64" }] }` — parallel completion; prompt may be empty if `images` is non-empty. |
| POST | `/api/evaluate` | Body: `prompt`, `candidates` (optional `latency_ms`, `input_note`), optional `run_attachment_note`, `failed_attempts`, `include_synthesis` — rubric (incl. evidence & recency), `winner_model_id`, `rationale`, `final_synthesis`, `highlights`, `excluded_failed_summary`. Env: `JUDGE_MODEL_ID`, `SYNTHESIS_MODEL_ID`. |
| POST | `/api/pipeline` | Same model ID fields as above; optional `images`. Draft must be vision-capable when `images` is set. Returns `final_answer`, status, trace (steps may include `attachment_note`). |

Omitting `model_ids` uses every model that has a configured key (useful for `curl`).

## Model IDs

Defaults live in `backend/main.py` (`MODEL_REGISTRY`). Adjust IDs to match your provider accounts and quotas.
