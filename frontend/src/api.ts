/** Set on Vercel to your Railway API origin, e.g. `https://xxx.up.railway.app` (no trailing slash). Leave unset to use same-origin `/api` (Vite proxy locally, vercel.json rewrite in prod). */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

import type { ContextBlock, ContextMessage } from "./firestore/types";

export type { ContextBlock, ContextMessage };

export type ImagePayload = {
  file_name: string;
  mime_type: string;
  base64: string;
};

export type ModelInfo = {
  model_id: string;
  provider: string;
  label: string;
  available: boolean;
  unavailable_reason: string | null;
  supports_vision: boolean;
  supported_input_types: string[];
  max_images: number;
  image_notes: string | null;
};

export type ModelOutput = {
  model_id: string;
  provider: string;
  label: string;
  content: string | null;
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
  latency_ms?: number | null;
  attachment_note?: string | null;
};

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(apiUrl("/api/models"));
  if (!res.ok) throw new Error(`Models request failed: ${res.status}`);
  const raw: unknown[] = await res.json();
  return raw.map((row) => {
    const m = row as Record<string, unknown>;
    return {
      model_id: String(m.model_id ?? ""),
      provider: String(m.provider ?? ""),
      label: String(m.label ?? ""),
      available: Boolean(m.available),
      unavailable_reason:
        m.unavailable_reason == null ? null : String(m.unavailable_reason),
      supports_vision: Boolean(m.supports_vision),
      supported_input_types: Array.isArray(m.supported_input_types)
        ? (m.supported_input_types as string[])
        : ["text"],
      max_images: typeof m.max_images === "number" ? m.max_images : 0,
      image_notes: m.image_notes == null ? null : String(m.image_notes),
    } satisfies ModelInfo;
  });
}

export async function generateParallel(
  prompt: string,
  modelIds: string[],
  context?: ContextBlock | null,
  images?: ImagePayload[] | null,
): Promise<ModelOutput[]> {
  const res = await fetch(apiUrl("/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model_ids: modelIds,
      ...(context ? { context } : {}),
      ...(images && images.length > 0 ? { images } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Generate failed: ${res.status}`);
  }
  return res.json();
}

export type ModelScore = {
  overall: number;
  accuracy: number;
  clarity: number;
  completeness: number;
  evidence: number;
  recency: number;
};

export type EvaluationHighlights = {
  best_quality_model_id: string | null;
  /** TODO: populate when per-model token/cost estimates exist in the API */
  best_value_model_id: string | null;
  fastest_model_id: string | null;
};

export type ModelAgreement = {
  agreed: string[];
  differed: string[];
};

export type PerModelJudgeNote = {
  best_for?: string | null;
  strength?: string | null;
  weakness?: string | null;
  note?: string | null;
};

export type EvaluationResult = {
  scores: Record<string, ModelScore>;
  winner_model_id: string;
  rationale: string;
  judge_model_id: string;
  final_synthesis: string | null;
  highlights: EvaluationHighlights;
  excluded_failed_summary: string[];
  winner_strengths?: string[];
  model_agreement?: ModelAgreement;
  per_model_notes?: Record<string, PerModelJudgeNote>;
};

export type FailedAttempt = {
  model_id: string;
  label: string;
  reason: string;
};

export type PipelineStepResult = {
  step: "draft" | "critique" | "improve" | "verify" | "final" | string;
  model_id: string | null;
  provider: string | null;
  label: string | null;
  content: string | null;
  structured: Record<string, unknown> | null;
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
  latency_ms: number | null;
  attachment_note?: string | null;
};

export type PipelineResult = {
  status: "completed" | "partial" | "failed" | string;
  final_answer: string | null;
  trace: PipelineStepResult[];
};

export async function evaluateResponses(
  prompt: string,
  candidates: {
    model_id: string;
    label: string;
    content: string;
    latency_ms?: number | null;
    input_note?: string | null;
  }[],
  failedAttempts: FailedAttempt[],
  options?: {
    include_synthesis?: boolean;
    context?: ContextBlock | null;
    run_attachment_note?: string | null;
  },
): Promise<EvaluationResult> {
  const res = await fetch(apiUrl("/api/evaluate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      candidates,
      failed_attempts: failedAttempts,
      include_synthesis: options?.include_synthesis ?? true,
      ...(options?.context ? { context: options.context } : {}),
      ...(options?.run_attachment_note
        ? { run_attachment_note: options.run_attachment_note }
        : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Evaluate failed: ${res.status}`);
  }
  const raw = (await res.json()) as EvaluationResult;
  return {
    ...raw,
    winner_strengths: Array.isArray(raw.winner_strengths) ? raw.winner_strengths : [],
    model_agreement: raw.model_agreement ?? { agreed: [], differed: [] },
    per_model_notes:
      raw.per_model_notes && typeof raw.per_model_notes === "object"
        ? raw.per_model_notes
        : {},
  };
}

export async function runPipeline(
  prompt: string,
  modelIds: {
    draft_model_id: string;
    critic_model_id: string;
    improver_model_id: string;
    verifier_model_id?: string | null;
    final_model_id: string;
  },
  context?: ContextBlock | null,
  images?: ImagePayload[] | null,
): Promise<PipelineResult> {
  const res = await fetch(apiUrl("/api/pipeline"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...modelIds,
      ...(context ? { context } : {}),
      ...(images && images.length > 0 ? { images } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Pipeline failed: ${res.status}`);
  }
  return res.json();
}

export type SummarizeRequest = {
  project_title?: string | null;
  project_summary?: string | null;
  chat_summary?: string | null;
  recent_messages: ContextMessage[];
  update_project_summary?: boolean;
};

export type SummarizeResult = {
  chat_summary: string;
  project_summary: string | null;
  decisions: string[];
  open_questions: string[];
  next_steps: string[];
};

export async function summarizeMemory(
  req: SummarizeRequest,
): Promise<SummarizeResult> {
  const res = await fetch(apiUrl("/api/summarize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Summarize failed: ${res.status}`);
  }
  return res.json();
}
