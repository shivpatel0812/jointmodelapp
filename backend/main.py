import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

# Always load backend/.env even if uvicorn is started from another cwd.
load_dotenv(Path(__file__).resolve().parent / ".env")

OPENAI_KEY = os.getenv("OPENAI_API_KEY") or ""
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY") or ""
GEMINI_KEY = (
    os.getenv("GEMINI_API_KEY")
    or os.getenv("GOOGLE_API_KEY")
    or os.getenv("Gemini_API_KEY")  # mistaken casing seen in .env files
    or ""
)

OPENAI_CLIENT = AsyncOpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None
ANTHROPIC_CLIENT = AsyncAnthropic(api_key=ANTHROPIC_KEY) if ANTHROPIC_KEY else None
GEMINI_CLIENT = genai.Client(api_key=GEMINI_KEY) if GEMINI_KEY else None

# Used only for /api/evaluate (structured JSON scoring). Requires OPENAI_API_KEY.
JUDGE_MODEL_ID = os.getenv("JUDGE_MODEL_ID") or "gpt-4o-mini"
SYNTHESIS_MODEL_ID = os.getenv("SYNTHESIS_MODEL_ID") or JUDGE_MODEL_ID
_JUDGE_MAX_CHARS_PER_ANSWER = 10_000

# Registered models for v1: parallel generation only (orchestration comes later).
MODEL_REGISTRY: list[dict[str, Any]] = [
    {
        "id": "gpt-4o-mini",
        "provider": "openai",
        "label": "GPT-4o Mini",
    },
    {
        "id": "gpt-4o",
        "provider": "openai",
        "label": "GPT-4o",
    },
    {
        "id": "claude-haiku-4-5",
        "provider": "anthropic",
        "label": "Claude Haiku 4.5",
    },
    {
        "id": "claude-sonnet-4-5",
        "provider": "anthropic",
        "label": "Claude Sonnet 4.5",
    },
    {
        "id": "gemini-2.0-flash",
        "provider": "gemini",
        "label": "Gemini 2.0 Flash",
    },
    {
        "id": "gemini-2.5-flash",
        "provider": "gemini",
        "label": "Gemini 2.5 Flash",
    },
]


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=32000)
    model_ids: list[str] | None = Field(
        default=None,
        description="Subset of model ids; default = all models with configured API keys.",
    )


class ModelOutput(BaseModel):
    model_id: str
    provider: str
    label: str
    content: str | None = None
    error: str | None = None
    skipped: bool = False
    skip_reason: str | None = None
    # Wall-clock ms for this model's generation (None if skipped before provider call).
    latency_ms: float | None = None


class ModelInfo(BaseModel):
    model_id: str
    provider: str
    label: str
    available: bool
    unavailable_reason: str | None = None


class EvaluateCandidate(BaseModel):
    model_id: str = Field(..., min_length=1, max_length=256)
    label: str = Field(..., min_length=1, max_length=256)
    content: str = Field(..., min_length=1, max_length=100_000)
    latency_ms: float | None = Field(
        default=None,
        ge=0,
        description="Optional client-reported latency for highlights.fastest_model_id.",
    )


class FailedAttempt(BaseModel):
    model_id: str = Field(..., min_length=1, max_length=256)
    label: str = Field(..., min_length=1, max_length=256)
    reason: str = Field(..., min_length=1, max_length=2000)


class EvaluateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=32000)
    candidates: list[EvaluateCandidate] = Field(..., min_length=1, max_length=16)
    judge_model_id: str | None = Field(
        default=None,
        description="OpenAI chat model id for judging; defaults to JUDGE_MODEL_ID env or gpt-4o-mini.",
    )
    include_synthesis: bool = Field(
        default=True,
        description="If true, produce final_synthesis after judging (OpenAI, same key).",
    )
    failed_attempts: list[FailedAttempt] = Field(
        default_factory=list,
        max_length=32,
        description="Models that errored or were skipped; excluded from scoring, mentioned in rationale.",
    )


class ModelScore(BaseModel):
    overall: int = Field(ge=1, le=5)
    accuracy: int = Field(ge=1, le=5)
    clarity: int = Field(ge=1, le=5)
    completeness: int = Field(ge=1, le=5)
    evidence: int = Field(ge=1, le=5)
    recency: int = Field(ge=1, le=5)


class EvaluationHighlights(BaseModel):
    """UI hints; best_value reserved until per-model cost/token estimates exist."""

    best_quality_model_id: str | None = None
    best_value_model_id: str | None = None  # TODO: set when token usage + pricing per model is tracked
    fastest_model_id: str | None = None


class EvaluationResult(BaseModel):
    scores: dict[str, ModelScore]
    winner_model_id: str
    rationale: str
    judge_model_id: str
    final_synthesis: str | None = None
    highlights: EvaluationHighlights
    excluded_failed_summary: list[str] = Field(
        default_factory=list,
        description="One line per failed model for UI (already excluded from scoring).",
    )


class PipelineRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=32000)
    draft_model_id: str = Field(..., min_length=1, max_length=256)
    critic_model_id: str = Field(..., min_length=1, max_length=256)
    improver_model_id: str = Field(..., min_length=1, max_length=256)
    verifier_model_id: str | None = Field(default=None, max_length=256)
    final_model_id: str = Field(..., min_length=1, max_length=256)


class PipelineStepResult(BaseModel):
    step: str
    model_id: str | None = None
    provider: str | None = None
    label: str | None = None
    content: str | None = None
    structured: dict[str, Any] | None = None
    error: str | None = None
    skipped: bool = False
    skip_reason: str | None = None
    latency_ms: float | None = None


class PipelineResult(BaseModel):
    status: str
    final_answer: str | None = None
    trace: list[PipelineStepResult]


app = FastAPI(title="Joint Model API", version="0.1.0")

_cors_extra = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *_cors_extra,
    ],
    # Preview + production Vercel hosts when the frontend calls Railway with VITE_API_BASE_URL
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _registry_by_id() -> dict[str, dict[str, Any]]:
    return {m["id"]: m for m in MODEL_REGISTRY}


def _model_available(meta: dict[str, Any]) -> tuple[bool, str | None]:
    prov = meta["provider"]
    if prov == "openai" and not OPENAI_CLIENT:
        return False, "OPENAI_API_KEY not set"
    if prov == "anthropic" and not ANTHROPIC_CLIENT:
        return False, "ANTHROPIC_API_KEY not set"
    if prov == "gemini" and not GEMINI_CLIENT:
        return False, "GEMINI_API_KEY or GOOGLE_API_KEY not set"
    return True, None


async def _run_openai(model_id: str, prompt: str) -> str:
    assert OPENAI_CLIENT is not None
    resp = await OPENAI_CLIENT.chat.completions.create(
        model=model_id,
        messages=[{"role": "user", "content": prompt}],
    )
    choice = resp.choices[0].message.content
    return choice or ""


async def _run_anthropic(model_id: str, prompt: str) -> str:
    assert ANTHROPIC_CLIENT is not None
    resp = await ANTHROPIC_CLIENT.messages.create(
        model=model_id,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts)


async def _run_gemini(model_id: str, prompt: str) -> str:
    assert GEMINI_CLIENT is not None
    resp = await GEMINI_CLIENT.aio.models.generate_content(
        model=model_id,
        contents=prompt,
    )
    return (resp.text or "").strip()


async def _run_model_text(meta: dict[str, Any], prompt: str) -> str:
    provider = meta["provider"]
    model_id = meta["id"]
    if provider == "openai":
        return await _run_openai(model_id, prompt)
    if provider == "anthropic":
        return await _run_anthropic(model_id, prompt)
    if provider == "gemini":
        return await _run_gemini(model_id, prompt)
    raise ValueError(f"Unknown provider: {provider}")


def _clamp_int_score(v: Any, default: int = 3) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(1, min(5, n))


def _looks_like_provider_error(text: str) -> bool:
    """Heuristic: treat obvious API error bodies as failed, not model answers."""
    s = text.strip()
    if len(s) < 12:
        return False
    low = s[:800].lower()
    if "error code:" in low or "invalid_api_key" in low or "resource_exhausted" in low:
        return True
    if low.startswith("error code:") or low.startswith('{"error"'):
        return True
    if re.match(r"^https?://", s.strip()):
        return True
    return False


def _extract_json_object(raw: str) -> str:
    """Strip fences / prose; return a substring likely to be valid JSON."""
    t = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", t, re.IGNORECASE)
    if fence:
        t = fence.group(1).strip()
    try:
        json.loads(t)
        return t
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end > start:
        return t[start : end + 1]
    return t


def _parse_judge_json(
    raw: str,
    valid_ids: set[str],
) -> tuple[dict[str, ModelScore], str, str]:
    """Parse judge model output into scores + winner; coerce invalid fields."""
    blob = _extract_json_object(raw)
    try:
        data = json.loads(blob)
    except json.JSONDecodeError as e:
        raise ValueError(f"Judge output is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("Judge output is not a JSON object")
    scores_in = data.get("scores")
    if not isinstance(scores_in, dict):
        raise ValueError("Missing scores object")
    scores: dict[str, ModelScore] = {}
    for mid in valid_ids:
        block = scores_in.get(mid)
        if not isinstance(block, dict):
            block = {}
        scores[mid] = ModelScore(
            overall=_clamp_int_score(block.get("overall")),
            accuracy=_clamp_int_score(block.get("accuracy")),
            clarity=_clamp_int_score(block.get("clarity")),
            completeness=_clamp_int_score(block.get("completeness")),
            evidence=_clamp_int_score(block.get("evidence")),
            recency=_clamp_int_score(block.get("recency")),
        )
    winner = str(data.get("winner_model_id", "") or "").strip()
    if winner not in valid_ids:
        ranked = sorted(
            valid_ids,
            key=lambda m: (-scores[m].overall, m),
        )
        winner = ranked[0]
    rationale = str(data.get("rationale", "") or "").strip()
    if len(rationale) > 4500:
        rationale = rationale[:4500] + "…"
    if not rationale:
        rationale = "No rationale provided by judge."
    return scores, winner, rationale


def _pick_fastest_model_id(candidates: list[EvaluateCandidate]) -> str | None:
    pairs = [(c.model_id, c.latency_ms) for c in candidates if c.latency_ms is not None]
    if not pairs:
        return None
    return min(pairs, key=lambda x: x[1])[0]


def _structured_from_text(raw: str, keys: list[str]) -> dict[str, Any]:
    try:
        parsed = json.loads(_extract_json_object(raw))
    except (json.JSONDecodeError, ValueError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    out: dict[str, Any] = {}
    for key in keys:
        value = parsed.get(key)
        if value is None:
            out[key] = []
        elif isinstance(value, list):
            out[key] = [str(v) for v in value]
        elif isinstance(value, bool):
            out[key] = value
        else:
            out[key] = [str(value)]
    if not parsed:
        out["raw"] = raw.strip()
    return out


def _safe_step_error(e: Exception) -> str:
    msg = str(e).strip()
    if not msg:
        return e.__class__.__name__
    return msg[:1200]


def _empty_step(step: str, model_id: str | None, reason: str) -> PipelineStepResult:
    return PipelineStepResult(
        step=step,
        model_id=model_id,
        skipped=True,
        skip_reason=reason,
    )


async def _run_pipeline_step(
    step: str,
    meta: dict[str, Any],
    prompt: str,
    structured_keys: list[str] | None = None,
) -> PipelineStepResult:
    ok, reason = _model_available(meta)
    if not ok:
        return PipelineStepResult(
            step=step,
            model_id=meta["id"],
            provider=meta["provider"],
            label=meta["label"],
            error=reason,
            skipped=True,
            skip_reason=reason,
        )
    t0 = time.perf_counter()
    try:
        content = await _run_model_text(meta, prompt)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        structured = (
            _structured_from_text(content, structured_keys)
            if structured_keys
            else None
        )
        return PipelineStepResult(
            step=step,
            model_id=meta["id"],
            provider=meta["provider"],
            label=meta["label"],
            content=content,
            structured=structured,
            latency_ms=latency_ms,
        )
    except Exception as e:  # noqa: BLE001
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return PipelineStepResult(
            step=step,
            model_id=meta["id"],
            provider=meta["provider"],
            label=meta["label"],
            error=_safe_step_error(e),
            latency_ms=latency_ms,
        )


async def _run_openai_plain_text(model_id: str, system: str, user: str) -> str:
    assert OPENAI_CLIENT is not None
    resp = await OPENAI_CLIENT.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.25,
        max_tokens=4096,
    )
    return (resp.choices[0].message.content or "").strip()


async def _run_openai_judge_json(model_id: str, system: str, user: str) -> str:
    assert OPENAI_CLIENT is not None
    resp = await OPENAI_CLIENT.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    choice = resp.choices[0].message.content
    return choice or "{}"


@app.post("/api/evaluate", response_model=EvaluationResult)
async def evaluate(req: EvaluateRequest) -> EvaluationResult:
    """
    Score each answer and pick a winner using an OpenAI judge (JSON output).
    Optionally synthesize one final answer from successful candidates only.
    """
    if not OPENAI_CLIENT:
        raise HTTPException(
            status_code=503,
            detail="Evaluation requires OPENAI_API_KEY (judge uses the OpenAI API).",
        )
    judge_id = (req.judge_model_id or JUDGE_MODEL_ID).strip()
    synth_id = SYNTHESIS_MODEL_ID.strip()

    valid_ids_raw = {c.model_id for c in req.candidates}
    if len(valid_ids_raw) != len(req.candidates):
        raise HTTPException(status_code=400, detail="Duplicate model_id in candidates.")

    screened: list[EvaluateCandidate] = []
    auto_excluded: list[str] = []
    for c in req.candidates:
        if _looks_like_provider_error(c.content):
            auto_excluded.append(
                f"{c.model_id} ({c.label}): omitted — body looks like a provider error, not an answer"
            )
            continue
        screened.append(c)

    if not screened:
        raise HTTPException(
            status_code=400,
            detail="No scorable candidates after filtering error-like payloads.",
        )

    valid_ids = {c.model_id for c in screened}
    excluded_lines: list[str] = [
        f"{f.model_id} ({f.label}): {f.reason.strip()[:400]}"
        for f in req.failed_attempts
    ]
    excluded_lines.extend(auto_excluded)
    excluded_block = ""
    if excluded_lines:
        excluded_block = (
            "\nThe following models FAILED or were skipped and MUST NOT be scored "
            "or named as winner (mention them once as excluded from scoring):\n"
            + "\n".join(f"- {line}" for line in excluded_lines)
            + "\n"
        )

    lines: list[str] = [
        f"User task / question:\n{req.prompt.strip()}\n",
        excluded_block,
        "Candidate answers (only these may receive scores and may win):\n",
    ]
    for i, c in enumerate(screened, start=1):
        body = c.content.strip()
        if len(body) > _JUDGE_MAX_CHARS_PER_ANSWER:
            body = body[:_JUDGE_MAX_CHARS_PER_ANSWER] + "\n…[truncated for judge context]"
        lines.append(
            f"--- Candidate {i} ---\n"
            f"model_id: {c.model_id}\n"
            f"label: {c.label}\n"
            f"answer:\n{body}\n"
        )
    user_blob = "\n".join(lines)

    system = """You are an impartial evaluator. You only see the candidate texts below—no web access—so do not claim an answer is "factually correct" unless the text itself cites verifiable sources or clear, checkable claims. Prefer answers that are internally consistent, hedged appropriately when uncertain, clear, complete for the question, well-supported WITHIN the text (quotes, links, named sources, or explicit reasoning), and—when the question is time-sensitive—explicit about dates, freshness, or limitations.

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "scores": {
    "<model_id>": {
      "overall": <1-5>,
      "accuracy": <1-5>,
      "clarity": <1-5>,
      "completeness": <1-5>,
      "evidence": <1-5 support within the answer: sources, citations, reasoning depth>,
      "recency": <1-5 how well time-sensitive aspects are handled; use 3 if not applicable>
    }
  },
  "winner_model_id": "<exactly one model_id from the scorable candidates>",
  "rationale": "<5-10 sentences. Name the winning model_id and label. Say why it won on the rubric (not generic praise). Name a close second if any and how it differed. Note concrete weaknesses in other answers (missing caveats, vague numbers, no support, outdated framing). If models were excluded from scoring, state that clearly. Avoid calling any answer 'accurate' unless the answer itself shows checkable support; otherwise say 'appears plausible' or 'well supported within the text'.>"
}

Rules:
- Every scorable candidate must have a scores entry keyed by exact model_id.
- Use the full 1–5 range when answers differ; avoid giving all 5s unless truly tied on every axis.
- winner_model_id must be one of the scorable candidate model_ids.
- Penalize confident-sounding but unsupported specifics for factual or current-events questions."""

    try:
        raw_json = await _run_openai_judge_json(judge_id, system, user_blob)
        scores, winner, rationale = _parse_judge_json(raw_json, valid_ids)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Judge returned invalid JSON: {e}",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Judge request failed: {e}") from e

    highlights = EvaluationHighlights(
        best_quality_model_id=winner,
        best_value_model_id=None,
        fastest_model_id=_pick_fastest_model_id(screened),
    )

    synthesis: str | None = None
    if req.include_synthesis:
        syn_lines = [
            "Write ONE polished answer the user can rely on. Merge the strongest, "
            "non-redundant parts of the candidate answers. Resolve disagreements cautiously "
            "(prefer hedging or 'sources differ' when candidates conflict). Do not invent "
            "facts beyond what candidates support. Omit model names unless needed for clarity.",
            f"\nOriginal question:\n{req.prompt.strip()}\n",
            "\nCandidates:\n",
        ]
        for c in screened:
            body = c.content.strip()
            if len(body) > 6000:
                body = body[:6000] + "\n…[truncated]"
            syn_lines.append(f"--- {c.label} ({c.model_id}) ---\n{body}\n")
        syn_user = "\n".join(syn_lines)
        syn_system = (
            "You are an editor synthesizing multiple draft answers into a single best response."
        )
        try:
            synthesis = await _run_openai_plain_text(synth_id, syn_system, syn_user)
        except Exception as e:  # noqa: BLE001
            synthesis = f"[Synthesis failed: {e}]"

    return EvaluationResult(
        scores=scores,
        winner_model_id=winner,
        rationale=rationale,
        judge_model_id=judge_id,
        final_synthesis=synthesis,
        highlights=highlights,
        excluded_failed_summary=excluded_lines,
    )


@app.post("/api/pipeline", response_model=PipelineResult)
async def run_pipeline(req: PipelineRequest) -> PipelineResult:
    registry = _registry_by_id()
    requested_ids = [
        req.draft_model_id,
        req.critic_model_id,
        req.improver_model_id,
        req.final_model_id,
    ]
    if req.verifier_model_id:
        requested_ids.append(req.verifier_model_id)
    for model_id in requested_ids:
        if model_id not in registry:
            raise HTTPException(status_code=400, detail=f"Unknown model_id: {model_id}")

    prompt = req.prompt.strip()
    trace: list[PipelineStepResult] = []

    draft_prompt = f"""Original user prompt:
{prompt}

Task: Write the best initial draft answer to the original prompt. Stay directly grounded in the prompt. If the prompt asks for current or factual information, include uncertainty or dates where appropriate."""
    draft = await _run_pipeline_step(
        "draft",
        registry[req.draft_model_id],
        draft_prompt,
    )
    trace.append(draft)
    if draft.error or draft.skipped or not draft.content:
        trace.extend(
            [
                _empty_step("critique", req.critic_model_id, "Skipped because draft failed."),
                _empty_step("improve", req.improver_model_id, "Skipped because draft failed."),
                _empty_step("verify", req.verifier_model_id, "Skipped because draft failed."),
                _empty_step("final", req.final_model_id, "Skipped because draft failed."),
            ]
        )
        return PipelineResult(status="failed", final_answer=None, trace=trace)

    critique_prompt = f"""Original user prompt:
{prompt}

Draft answer to critique:
{draft.content}

Task: Critique the draft while keeping the original prompt in view. Return ONLY valid JSON with this exact shape:
{{
  "strengths": ["..."],
  "issues": ["..."],
  "missing_points": ["..."],
  "unsupported_claims": ["..."],
  "recommended_changes": ["..."]
}}

Focus on factual risk, missing caveats, unsupported claims, clarity, completeness, and whether the draft actually answers the original prompt."""
    critique = await _run_pipeline_step(
        "critique",
        registry[req.critic_model_id],
        critique_prompt,
        [
            "strengths",
            "issues",
            "missing_points",
            "unsupported_claims",
            "recommended_changes",
        ],
    )
    trace.append(critique)
    if critique.error or critique.skipped or not critique.content:
        trace.extend(
            [
                _empty_step("improve", req.improver_model_id, "Skipped because critique failed."),
                _empty_step("verify", req.verifier_model_id, "Skipped because critique failed."),
                _empty_step("final", req.final_model_id, "Skipped because critique failed."),
            ]
        )
        return PipelineResult(status="failed", final_answer=None, trace=trace)

    critique_for_prompt = json.dumps(critique.structured, indent=2) if critique.structured else critique.content
    improve_prompt = f"""Original user prompt:
{prompt}

Draft answer:
{draft.content}

Structured critique:
{critique_for_prompt}

Task: Produce an improved answer. Keep what is strong, address the critique, remove or hedge unsupported claims, and stay focused on the original prompt."""
    improve = await _run_pipeline_step(
        "improve",
        registry[req.improver_model_id],
        improve_prompt,
    )
    trace.append(improve)
    if improve.error or improve.skipped or not improve.content:
        trace.extend(
            [
                _empty_step("verify", req.verifier_model_id, "Skipped because improve failed."),
                _empty_step("final", req.final_model_id, "Skipped because improve failed."),
            ]
        )
        return PipelineResult(status="failed", final_answer=None, trace=trace)

    verification_notes = (
        "Verification was not run. Final answer should be based on the improved answer "
        "and should preserve uncertainty where the improved answer lacks support."
    )
    if req.verifier_model_id:
        verify_prompt = f"""Original user prompt:
{prompt}

Improved answer to verify:
{improve.content}

Task: Verify whether the improved answer is ready to use. Return ONLY valid JSON with this exact shape:
{{
  "passes": true,
  "remaining_issues": ["..."],
  "claims_to_verify": ["..."],
  "final_recommendations": ["..."]
}}

Be conservative. If a claim needs external checking, list it under claims_to_verify instead of pretending it is confirmed."""
        verify = await _run_pipeline_step(
            "verify",
            registry[req.verifier_model_id],
            verify_prompt,
            [
                "passes",
                "remaining_issues",
                "claims_to_verify",
                "final_recommendations",
            ],
        )
        trace.append(verify)
        if verify.error or verify.skipped or not verify.content:
            verification_notes = (
                f"Verification step failed or was skipped: "
                f"{verify.error or verify.skip_reason or 'unknown reason'}. "
                "Continue safely from the improved answer; do not treat unverified claims as confirmed."
            )
        else:
            verification_notes = json.dumps(verify.structured, indent=2) if verify.structured else verify.content
    else:
        trace.append(_empty_step("verify", None, "No verifier model selected."))

    final_prompt = f"""Original user prompt:
{prompt}

Improved answer:
{improve.content}

Verification notes:
{verification_notes}

Task: Produce the final joint answer for the user. The final answer must be generated from the improved answer and the verification notes, while still answering the original prompt. If verification notes identify unresolved claims, either remove those claims, hedge them, or clearly state what should be checked."""
    final = await _run_pipeline_step(
        "final",
        registry[req.final_model_id],
        final_prompt,
    )
    trace.append(final)
    if final.error or final.skipped or not final.content:
        return PipelineResult(status="failed", final_answer=None, trace=trace)

    status = "completed"
    verify_step = next((s for s in trace if s.step == "verify"), None)
    if verify_step and (verify_step.error or verify_step.skipped):
        status = "partial"
    return PipelineResult(status=status, final_answer=final.content, trace=trace)


async def _generate_one(meta: dict[str, Any], prompt: str) -> ModelOutput:
    mid = meta["id"]
    label = meta["label"]
    provider = meta["provider"]
    ok, reason = _model_available(meta)
    if not ok:
        return ModelOutput(
            model_id=mid,
            provider=provider,
            label=label,
            skipped=True,
            skip_reason=reason,
        )
    try:
        if provider == "openai":
            text = await _run_openai(mid, prompt)
        elif provider == "anthropic":
            text = await _run_anthropic(mid, prompt)
        elif provider == "gemini":
            text = await _run_gemini(mid, prompt)
        else:
            return ModelOutput(
                model_id=mid,
                provider=provider,
                label=label,
                error=f"Unknown provider: {provider}",
            )
        return ModelOutput(
            model_id=mid,
            provider=provider,
            label=label,
            content=text,
        )
    except Exception as e:  # noqa: BLE001 — surface per-model failures to the client
        return ModelOutput(
            model_id=mid,
            provider=provider,
            label=label,
            error=str(e),
        )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/models", response_model=list[ModelInfo])
async def list_models() -> list[ModelInfo]:
    out: list[ModelInfo] = []
    for meta in MODEL_REGISTRY:
        ok, reason = _model_available(meta)
        out.append(
            ModelInfo(
                model_id=meta["id"],
                provider=meta["provider"],
                label=meta["label"],
                available=ok,
                unavailable_reason=reason if not ok else None,
            )
        )
    return out


@app.post("/api/generate", response_model=list[ModelOutput])
async def generate(req: GenerateRequest) -> list[ModelOutput]:
    registry = _registry_by_id()
    if req.model_ids is not None and len(req.model_ids) == 0:
        raise HTTPException(
            status_code=400,
            detail="model_ids must contain at least one model, or omit the field to use all available.",
        )
    if req.model_ids:
        chosen = []
        seen: set[str] = set()
        for mid in req.model_ids:
            if mid in seen:
                continue
            seen.add(mid)
            if mid not in registry:
                raise HTTPException(status_code=400, detail=f"Unknown model_id: {mid}")
            chosen.append(registry[mid])
    else:
        chosen = [
            m for m in MODEL_REGISTRY if _model_available(m)[0]
        ]
        if not chosen:
            return [
                ModelOutput(
                    model_id="_none",
                    provider="system",
                    label="No models",
                    error="No API keys configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, and/or GEMINI_API_KEY (or GOOGLE_API_KEY).",
                )
            ]

    async def _timed(meta: dict[str, Any], p: str) -> ModelOutput:
        t0 = time.perf_counter()
        out = await _generate_one(meta, p)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        if out.skipped:
            return out.model_copy(update={"latency_ms": None})
        return out.model_copy(update={"latency_ms": elapsed_ms})

    tasks = [_timed(meta, req.prompt) for meta in chosen]
    return await asyncio.gather(*tasks)
