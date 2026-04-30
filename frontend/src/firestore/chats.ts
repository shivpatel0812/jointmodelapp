import {
  type FieldValue,
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import type { BranchSource, Chat } from "./types";
import { BRANCH_CONTEXT_MODE, saveMessage } from "./messages";

// TODO(auth): rules should restrict reads/writes to the chat's owning user.

export async function listChats(
  uid: string,
  projectId: string | null = null,
): Promise<Chat[]> {
  const base = collection(db, "users", uid, "chats");
  const q = projectId
    ? query(base, where("projectId", "==", projectId), orderBy("updatedAt", "desc"))
    : query(base, orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(toChat);
}

export async function getChat(uid: string, chatId: string): Promise<Chat | null> {
  const ref = doc(db, "users", uid, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toChat(snap);
}

export async function createChat(
  uid: string,
  data: { projectId: string | null; title?: string },
): Promise<string> {
  const now = Timestamp.now();
  const ref = await addDoc(collection(db, "users", uid, "chats"), {
    projectId: data.projectId,
    title: (data.title ?? "New chat").trim().slice(0, 240) || "New chat",
    summary: "",
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateChat(
  uid: string,
  chatId: string,
  patch: Partial<Pick<Chat, "title" | "summary" | "projectId">>,
): Promise<void> {
  const update: Record<string, FieldValue | string | null> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.title !== undefined) update.title = patch.title.trim().slice(0, 240);
  if (patch.summary !== undefined) update.summary = patch.summary.slice(0, 8_000);
  if (patch.projectId !== undefined) update.projectId = patch.projectId;
  await updateDoc(doc(db, "users", uid, "chats", chatId), update);
}

/**
 * Touch the chat's `updatedAt` so it re-sorts to the top of the list.
 * Use after sending a turn or saving a run.
 */
export async function touchChat(uid: string, chatId: string): Promise<void> {
  await updateDoc(doc(db, "users", uid, "chats", chatId), {
    updatedAt: serverTimestamp(),
  });
}

function toChat(snap: { id: string; data(): Record<string, unknown> }): Chat {
  const d = snap.data() ?? {};
  const branchSource = (d.branchSource as BranchSource | null | undefined) ?? null;
  return {
    id: snap.id,
    projectId: (d.projectId as string | null | undefined) ?? null,
    title: String(d.title ?? "New chat"),
    summary: String(d.summary ?? ""),
    createdAt: (d.createdAt as Timestamp | undefined) ?? null,
    updatedAt: (d.updatedAt as Timestamp | undefined) ?? null,
    parentChatId: (d.parentChatId as string | null | undefined) ?? null,
    isBranch: Boolean(d.isBranch),
    branchSource,
  };
}

// ---------------------------------------------------------------------------
// Branch chats — "Continue from this response"
// ---------------------------------------------------------------------------

/** Same caps used elsewhere; keeps a branch chat doc reasonable. */
const BRANCH_FIELD_MAX = 12_000;
const BRANCH_SIBLING_MAX_CHARS = 1_800;
const BRANCH_SIBLING_MAX_COUNT = 8;
const BRANCH_PIPELINE_STEP_MAX = 8;

function clip(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/**
 * Compact a `BranchSource` for storage so we never blow up a chat document.
 * Pipeline trace is reduced to step labels + short summaries; sibling
 * responses get clipped + capped.
 *
 * TODO(memory): when `sourceRunId` reliably points back to a `ModelRun`,
 * lazy-load full siblings/pipeline trace from there instead of denormalizing.
 */
function sanitizeBranchSource(src: BranchSource): BranchSource {
  return {
    ...src,
    originalPrompt: clip(src.originalPrompt, BRANCH_FIELD_MAX) ?? "",
    selectedResponse: clip(src.selectedResponse, BRANCH_FIELD_MAX) ?? "",
    siblingResponses: src.siblingResponses.slice(0, BRANCH_SIBLING_MAX_COUNT).map((s) => ({
      modelId: s.modelId,
      modelLabel: s.modelLabel,
      provider: s.provider ?? null,
      response: clip(s.response, BRANCH_SIBLING_MAX_CHARS) ?? "",
    })),
    judgeSummary: clip(src.judgeSummary ?? null, 4_000),
    finalSynthesis: clip(src.finalSynthesis ?? null, BRANCH_FIELD_MAX),
    pipelineTrace: src.pipelineTrace
      ? {
          status: src.pipelineTrace.status,
          finalAnswer: clip(src.pipelineTrace.finalAnswer ?? null, BRANCH_FIELD_MAX),
          steps: src.pipelineTrace.steps.slice(0, BRANCH_PIPELINE_STEP_MAX).map((s) => ({
            step: s.step,
            modelLabel: s.modelLabel ?? null,
            summary: clip(s.summary ?? null, 600),
          })),
        }
      : null,
    createdAt: src.createdAt ?? Timestamp.now(),
  };
}

function defaultBranchTitle(modelLabel: string): string {
  return `Discuss ${modelLabel} response`.slice(0, 240);
}

function buildBranchSeedMessage(src: BranchSource): string {
  const lines: string[] = [
    `Continuing from ${src.sourceModelLabel} response.`,
  ];
  const extras: string[] = [];
  if (src.siblingResponses.length > 0) {
    extras.push(`other model responses (${src.siblingResponses.length})`);
  }
  if (src.judgeSummary) extras.push("judge summary");
  if (src.finalSynthesis) extras.push("final synthesis");
  if (src.pipelineTrace) extras.push("pipeline trace");
  if (extras.length > 0) {
    lines.push(`Included as context: ${extras.join(", ")}.`);
  }
  return lines.join(" ");
}

/**
 * Create a branch chat seeded from a source model response. Returns the new
 * chat id. Performs:
 *   1. addDoc(chats) with parentChatId/isBranch/branchSource
 *   2. saveMessage(role:"system", mode:"branch_context", metadata.branchSource)
 *
 * Errors propagate; callers surface a friendly message.
 */
export async function createBranchChat(args: {
  uid: string;
  projectId: string | null;
  parentChatId: string;
  title?: string;
  branchSource: BranchSource;
}): Promise<string> {
  const safeSource = sanitizeBranchSource(args.branchSource);
  const title =
    (args.title ?? "").trim().slice(0, 240) ||
    defaultBranchTitle(safeSource.sourceModelLabel);

  const now = Timestamp.now();
  const chatRef = await addDoc(collection(db, "users", args.uid, "chats"), {
    projectId: args.projectId,
    title,
    summary: `Branch from ${safeSource.sourceModelLabel} response`,
    createdAt: now,
    updatedAt: now,
    parentChatId: args.parentChatId,
    isBranch: true,
    branchSource: safeSource,
  });

  await saveMessage(args.uid, chatRef.id, {
    role: "system",
    content: buildBranchSeedMessage(safeSource),
    mode: BRANCH_CONTEXT_MODE,
    metadata: {
      branchSource: safeSource,
      parentChatId: args.parentChatId,
    },
  });

  return chatRef.id;
}

/** Convenience: read just the BranchSource off a chat doc, if present. */
export async function getBranchSource(
  uid: string,
  chatId: string,
): Promise<BranchSource | null> {
  const c = await getChat(uid, chatId);
  return c?.branchSource ?? null;
}
