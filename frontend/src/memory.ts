import {
  summarizeMemory,
  type EvaluationResult,
  type ModelOutput,
  type PipelineResult,
} from "./api";
import { touchChat, updateChat } from "./firestore/chats";
import { saveMessage } from "./firestore/messages";
import { updateProject } from "./firestore/projects";
import { saveProjectRun } from "./firestore/runs";
import type {
  Chat,
  ContextMessage,
  Project,
  RunMode,
} from "./firestore/types";
import { loadRecentMessages } from "./firestore/messages";

/**
 * Persist a user prompt to the chat. Returns the new doc id.
 */
export async function recordUserMessage(
  uid: string,
  chatId: string,
  prompt: string,
  mode: RunMode,
): Promise<string> {
  const id = await saveMessage(uid, chatId, {
    role: "user",
    content: prompt,
    mode,
  });
  await touchChat(uid, chatId).catch(() => {
    // best-effort
  });
  return id;
}

/**
 * Persist the per-model assistant outputs from compare / synthesize runs.
 * Skipped + errored entries are also saved so the timeline reflects what
 * actually happened.
 */
export async function recordCompareOutputs(
  uid: string,
  chatId: string,
  mode: RunMode,
  outputs: ModelOutput[],
): Promise<void> {
  await Promise.all(
    outputs.map((o) => {
      const role: "assistant" | "system" = o.error || o.skipped ? "system" : "assistant";
      const content = o.error
        ? `[error: ${o.error}]`
        : o.skipped
          ? `[skipped: ${o.skip_reason ?? "unavailable"}]`
          : (o.content ?? "");
      if (!content) return Promise.resolve("");
      return saveMessage(uid, chatId, {
        role,
        content,
        modelId: o.model_id,
        mode,
        latencyMs: o.latency_ms ?? null,
      });
    }),
  );
}

/**
 * Persist the final synthesized answer (compare + synthesize mode).
 */
export async function recordSynthesis(
  uid: string,
  chatId: string,
  mode: RunMode,
  evaluation: EvaluationResult,
): Promise<void> {
  if (!evaluation.final_synthesis) return;
  await saveMessage(uid, chatId, {
    role: "assistant",
    content: evaluation.final_synthesis,
    modelId: evaluation.judge_model_id,
    mode,
  });
}

/**
 * Persist the joint-pipeline final answer.
 */
export async function recordPipelineFinal(
  uid: string,
  chatId: string,
  mode: RunMode,
  result: PipelineResult,
): Promise<void> {
  if (!result.final_answer) return;
  const finalStep = result.trace.find((s) => s.step === "final");
  await saveMessage(uid, chatId, {
    role: "assistant",
    content: result.final_answer,
    modelId: finalStep?.model_id ?? null,
    mode,
    latencyMs: finalStep?.latency_ms ?? null,
  });
}

/**
 * Persist the full structured run under the project (if there is one). This is
 * a no-op when no project is selected — the legacy users/{uid}/runs path is
 * still written from App.tsx for non-project runs.
 */
export async function recordProjectRun(
  uid: string,
  projectId: string,
  args: {
    mode: RunMode;
    prompt: string;
    selectedModels: string[];
    outputs: ModelOutput[] | null;
    evaluation: EvaluationResult | null;
    pipelineResult: PipelineResult | null;
  },
): Promise<void> {
  const failedAttempts = (args.outputs ?? [])
    .filter((o) => o.skipped || o.error)
    .map((o) => ({
      model_id: o.model_id,
      label: o.label,
      reason: o.skipped
        ? (o.skip_reason ?? "Model was skipped")
        : (o.error ?? "Unknown error"),
    }));
  await saveProjectRun(uid, projectId, {
    mode: args.mode,
    prompt: args.prompt,
    selectedModels: args.selectedModels,
    outputs: args.outputs,
    evaluation: args.evaluation,
    pipelineResult: args.pipelineResult,
    failedAttempts,
  });
}

const SUMMARY_EVERY_TURNS = 4;

/**
 * Decide whether we should refresh the rolling summary now.
 * Triggers every {@link SUMMARY_EVERY_TURNS} user turns based on the message count.
 */
export function shouldRefreshSummary(messageCount: number): boolean {
  if (messageCount <= 0) return false;
  // Roughly: every N user messages → ~2N total messages.
  return messageCount % (SUMMARY_EVERY_TURNS * 2) === 0;
}

/**
 * Pull the latest 10–14 messages from the chat and ask the backend
 * summarizer to produce updated chat + project summaries. Persists the
 * updates to Firestore. Best-effort; failures are swallowed.
 */
export async function refreshRollingSummary(
  uid: string,
  chat: Chat,
  project: Project | null,
): Promise<void> {
  try {
    const recent = await loadRecentMessages(uid, chat.id, 14);
    if (recent.length === 0 && !chat.summary) return;
    const recent_messages: ContextMessage[] = recent.map((m) => ({
      role: m.role,
      content: m.content,
      model_id: m.modelId ?? null,
    }));
    const result = await summarizeMemory({
      project_title: project?.title ?? null,
      project_summary: project?.currentSummary ?? null,
      chat_summary: chat.summary ?? null,
      recent_messages,
      update_project_summary: Boolean(project),
    });

    const writes: Promise<unknown>[] = [];
    if (result.chat_summary) {
      writes.push(updateChat(uid, chat.id, { summary: result.chat_summary }));
    }
    if (project && result.project_summary) {
      const decisions = uniqueAppend(
        project.decisions,
        result.decisions,
        12,
      );
      const openQuestions = result.open_questions.slice(0, 8);
      writes.push(
        updateProject(uid, project.id, {
          currentSummary: result.project_summary,
          decisions,
          openQuestions,
        }),
      );
    }
    await Promise.all(writes);
  } catch {
    // Non-blocking: a failed summary should never break the chat flow.
  }
}

function uniqueAppend(
  current: string[],
  incoming: string[],
  cap: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...incoming, ...current]) {
    const t = s.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}
