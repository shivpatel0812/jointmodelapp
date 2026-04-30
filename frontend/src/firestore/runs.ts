import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase";
import type {
  EvaluationResult,
  FailedAttempt,
  ModelOutput,
  PipelineResult,
  PipelineStepResult,
} from "../api";
import type {
  ModelRun,
  RunMode,
  StoredJudgeResult,
  StoredPipelineTrace,
} from "./types";

const MAX_CONTENT_CHARS = 4_000;
const MAX_OUTPUTS = 12;

export type SaveProjectRunInput = {
  mode: RunMode;
  prompt: string;
  selectedModels: string[];
  outputs: ModelOutput[] | null;
  evaluation: EvaluationResult | null;
  pipelineResult: PipelineResult | null;
  failedAttempts: FailedAttempt[];
};

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sanitizeOutputs(outputs: ModelOutput[]): ModelOutput[] {
  return outputs.slice(0, MAX_OUTPUTS).map((o) => ({
    ...o,
    content: truncate(o.content, MAX_CONTENT_CHARS),
    error: truncate(o.error, 800),
  }));
}

function sanitizeTrace(trace: PipelineStepResult[]): PipelineStepResult[] {
  return trace.map((step) => ({
    ...step,
    content: truncate(step.content, MAX_CONTENT_CHARS),
    error: truncate(step.error, 600),
  }));
}

function deriveFinalAnswer(input: SaveProjectRunInput): string | null {
  if (input.mode === "pipeline") {
    return input.pipelineResult?.final_answer ?? null;
  }
  if (input.mode === "synthesize") {
    return input.evaluation?.final_synthesis ?? null;
  }
  return null;
}

function buildJudgeResult(ev: EvaluationResult | null): StoredJudgeResult | null {
  if (!ev) return null;
  return {
    winner_model_id: ev.winner_model_id,
    rationale: ev.rationale,
    scores: ev.scores,
    final_synthesis: ev.final_synthesis,
    judge_model_id: ev.judge_model_id,
  };
}

function buildPipelineTrace(
  result: PipelineResult | null,
): StoredPipelineTrace | null {
  if (!result) return null;
  return {
    status: result.status,
    final_answer: truncate(result.final_answer, MAX_CONTENT_CHARS),
    trace: sanitizeTrace(result.trace),
  };
}

/**
 * Save a model run scoped to a project. This is the new, project-aware path
 * (users/{uid}/projects/{projectId}/runs/{runId}).
 *
 * The legacy flat history at users/{uid}/runs (see ../db.ts) is preserved for
 * runs that don't belong to a project yet.
 */
export async function saveProjectRun(
  uid: string,
  projectId: string,
  input: SaveProjectRunInput,
): Promise<string> {
  const ref = await addDoc(
    collection(db, "users", uid, "projects", projectId, "runs"),
    {
      mode: input.mode,
      prompt: truncate(input.prompt, MAX_CONTENT_CHARS),
      selectedModels: input.selectedModels.slice(0, 16),
      finalAnswer: deriveFinalAnswer(input),
      judgeResult: buildJudgeResult(input.evaluation),
      pipelineTrace: buildPipelineTrace(input.pipelineResult),
      failedAttempts: input.failedAttempts.slice(0, 16).map((f) => ({
        model_id: f.model_id,
        label: f.label,
        reason: truncate(f.reason, 600),
      })),
      outputs: input.outputs ? sanitizeOutputs(input.outputs) : null,
      evaluation: input.evaluation ?? null,
      createdAt: Timestamp.now(),
    },
  );
  return ref.id;
}

export async function loadProjectRuns(
  uid: string,
  projectId: string,
  count = 30,
): Promise<ModelRun[]> {
  const q = query(
    collection(db, "users", uid, "projects", projectId, "runs"),
    orderBy("createdAt", "desc"),
    limit(count),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      mode: (v.mode as RunMode) ?? "compare",
      prompt: String(v.prompt ?? ""),
      selectedModels: Array.isArray(v.selectedModels)
        ? (v.selectedModels as string[])
        : [],
      finalAnswer: (v.finalAnswer as string | null | undefined) ?? null,
      judgeResult: (v.judgeResult as StoredJudgeResult | null | undefined) ?? null,
      pipelineTrace:
        (v.pipelineTrace as StoredPipelineTrace | null | undefined) ?? null,
      failedAttempts: Array.isArray(v.failedAttempts)
        ? (v.failedAttempts as FailedAttempt[])
        : [],
      outputs: (v.outputs as ModelOutput[] | null | undefined) ?? null,
      evaluation: (v.evaluation as EvaluationResult | null | undefined) ?? null,
      createdAt: (v.createdAt as Timestamp | undefined) ?? null,
    } satisfies ModelRun;
  });
}
