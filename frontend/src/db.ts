import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "./firebase";
import type { EvaluationResult, ModelOutput, PipelineResult } from "./api";

export type RunMode = "compare" | "synthesize" | "pipeline";

export type SavedRun = {
  id: string;
  prompt: string;
  mode: RunMode;
  created_at: Timestamp | null;
  // compare / synthesize
  outputs?: ModelOutput[] | null;
  evaluation?: EvaluationResult | null;
  // pipeline
  pipelineResult?: PipelineResult | null;
  // derived summary for the history list
  summary: string;
};

const MAX_CONTENT_CHARS = 3000;
const MAX_OUTPUTS = 12;

function truncateStr(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sanitizeOutputs(outputs: ModelOutput[]): ModelOutput[] {
  return outputs.slice(0, MAX_OUTPUTS).map((o) => ({
    ...o,
    content: truncateStr(o.content, MAX_CONTENT_CHARS),
    error: truncateStr(o.error, 800),
  }));
}

function sanitizePipeline(r: PipelineResult): PipelineResult {
  return {
    ...r,
    final_answer: truncateStr(r.final_answer, MAX_CONTENT_CHARS),
    trace: r.trace.map((step) => ({
      ...step,
      content: truncateStr(step.content, MAX_CONTENT_CHARS),
      error: truncateStr(step.error, 600),
    })),
  };
}

function makeSummary(run: Omit<SavedRun, "id" | "created_at" | "summary">): string {
  if (run.mode === "pipeline" && run.pipelineResult) {
    const status = run.pipelineResult.status;
    const snippet = run.pipelineResult.final_answer?.slice(0, 120) ?? "No answer";
    return `[${status}] ${snippet}`;
  }
  if (run.mode === "synthesize" && run.evaluation?.final_synthesis) {
    return run.evaluation.final_synthesis.slice(0, 120);
  }
  if (run.outputs && run.outputs.length > 0) {
    const first = run.outputs.find((o) => !o.error && !o.skipped && o.content);
    return first?.content?.slice(0, 120) ?? "No successful response";
  }
  return "No results";
}

export async function saveRun(
  uid: string,
  data: Omit<SavedRun, "id" | "created_at">,
): Promise<string> {
  const ref = await addDoc(collection(db, "users", uid, "runs"), {
    prompt: data.prompt,
    mode: data.mode,
    summary: data.summary,
    created_at: Timestamp.now(),
    ...(data.outputs != null
      ? { outputs: sanitizeOutputs(data.outputs) }
      : {}),
    ...(data.evaluation != null ? { evaluation: data.evaluation } : {}),
    ...(data.pipelineResult != null
      ? { pipelineResult: sanitizePipeline(data.pipelineResult) }
      : {}),
  });
  return ref.id;
}

export async function loadRecentRuns(
  uid: string,
  count = 30,
): Promise<SavedRun[]> {
  const q = query(
    collection(db, "users", uid, "runs"),
    orderBy("created_at", "desc"),
    limit(count),
  );
  const snap = await getDocs(q);
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      prompt: d.prompt ?? "",
      mode: d.mode ?? "compare",
      created_at: d.created_at ?? null,
      outputs: d.outputs ?? null,
      evaluation: d.evaluation ?? null,
      pipelineResult: d.pipelineResult ?? null,
      summary: d.summary ?? "",
    } as SavedRun;
  });
}

export { makeSummary };
