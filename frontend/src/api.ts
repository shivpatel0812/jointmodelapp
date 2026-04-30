/** Set on Vercel to your Railway API origin, e.g. `https://xxx.up.railway.app` (no trailing slash). Leave unset to use same-origin `/api` (Vite proxy locally, vercel.json rewrite in prod). */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

import type { ContextBlock, ContextMessage } from "./firestore/types";

export type { ContextBlock, ContextMessage };

export type ModelInfo = {
  model_id: string;
  provider: string;
  label: string;
  available: boolean;
  unavailable_reason: string | null;
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
};

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(apiUrl("/api/models"));
  if (!res.ok) throw new Error(`Models request failed: ${res.status}`);
  return res.json();
}

export async function generateParallel(
  prompt: string,
  modelIds: string[],
  context?: ContextBlock | null,
): Promise<ModelOutput[]> {
  const res = await fetch(apiUrl("/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model_ids: modelIds,
      ...(context ? { context } : {}),
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

export type EvaluationResult = {
  scores: Record<string, ModelScore>;
  winner_model_id: string;
  rationale: string;
  judge_model_id: string;
  final_synthesis: string | null;
  highlights: EvaluationHighlights;
  excluded_failed_summary: string[];
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
  }[],
  failedAttempts: FailedAttempt[],
  options?: { include_synthesis?: boolean; context?: ContextBlock | null },
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
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Evaluate failed: ${res.status}`);
  }
  return res.json();
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
): Promise<PipelineResult> {
  const res = await fetch(apiUrl("/api/pipeline"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ...modelIds,
      ...(context ? { context } : {}),
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
