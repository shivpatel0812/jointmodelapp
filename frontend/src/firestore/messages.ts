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
import type { ChatMessage, RunMode, SystemMessageMode } from "./types";

const MAX_MESSAGE_CHARS = 12_000;

export type SaveMessageInput = {
  role: "user" | "assistant" | "system";
  content: string;
  modelId?: string | null;
  /** Persists `RunMode` plus system-only modes like `branch_context`. */
  mode?: RunMode | SystemMessageMode | null;
  latencyMs?: number | null;
  tokenCount?: number | null;
  costEstimate?: number | null;
  /** Metadata only — never base64 image payloads. */
  attachments?: { fileName: string; mimeType: string; sizeBytes: number }[] | null;
  /** Optional structured metadata (e.g. branch source pointer). */
  metadata?: Record<string, unknown> | null;
};

/** Used by ChatThread/ContextBuilder to filter out the seed system message. */
export const BRANCH_CONTEXT_MODE = "branch_context" as const;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export async function saveMessage(
  uid: string,
  chatId: string,
  msg: SaveMessageInput,
): Promise<string> {
  const ref = await addDoc(
    collection(db, "users", uid, "chats", chatId, "messages"),
    {
      role: msg.role,
      content: truncate(msg.content ?? "", MAX_MESSAGE_CHARS),
      modelId: msg.modelId ?? null,
      mode: msg.mode ?? null,
      latencyMs: msg.latencyMs ?? null,
      tokenCount: msg.tokenCount ?? null,
      costEstimate: msg.costEstimate ?? null,
      attachments: msg.attachments?.length ? msg.attachments : null,
      metadata: msg.metadata ?? null,
      createdAt: Timestamp.now(),
    },
  );
  return ref.id;
}

export async function loadMessages(
  uid: string,
  chatId: string,
  count = 200,
): Promise<ChatMessage[]> {
  const q = query(
    collection(db, "users", uid, "chats", chatId, "messages"),
    orderBy("createdAt", "asc"),
    limit(count),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      role: (v.role as ChatMessage["role"]) ?? "assistant",
      content: String(v.content ?? ""),
      modelId: (v.modelId as string | null | undefined) ?? null,
      mode: (v.mode as ChatMessage["mode"] | undefined) ?? null,
      createdAt: (v.createdAt as Timestamp | undefined) ?? null,
      latencyMs: (v.latencyMs as number | null | undefined) ?? null,
      tokenCount: (v.tokenCount as number | null | undefined) ?? null,
      costEstimate: (v.costEstimate as number | null | undefined) ?? null,
      attachments: Array.isArray(v.attachments)
        ? (v.attachments as ChatMessage["attachments"])
        : null,
      metadata:
        v.metadata && typeof v.metadata === "object"
          ? (v.metadata as Record<string, unknown>)
          : null,
    } satisfies ChatMessage;
  });
}

/**
 * Return the most recent N messages, oldest-first. Used to seed
 * `ContextBlock.recent_messages` without dragging the whole chat across the wire.
 */
export async function loadRecentMessages(
  uid: string,
  chatId: string,
  count = 12,
): Promise<ChatMessage[]> {
  const q = query(
    collection(db, "users", uid, "chats", chatId, "messages"),
    orderBy("createdAt", "desc"),
    limit(count),
  );
  const snap = await getDocs(q);
  const arr = snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      role: (v.role as ChatMessage["role"]) ?? "assistant",
      content: String(v.content ?? ""),
      modelId: (v.modelId as string | null | undefined) ?? null,
      mode: (v.mode as ChatMessage["mode"] | undefined) ?? null,
      createdAt: (v.createdAt as Timestamp | undefined) ?? null,
      latencyMs: (v.latencyMs as number | null | undefined) ?? null,
      tokenCount: (v.tokenCount as number | null | undefined) ?? null,
      costEstimate: (v.costEstimate as number | null | undefined) ?? null,
      attachments: Array.isArray(v.attachments)
        ? (v.attachments as ChatMessage["attachments"])
        : null,
      metadata:
        v.metadata && typeof v.metadata === "object"
          ? (v.metadata as Record<string, unknown>)
          : null,
    } satisfies ChatMessage;
  });
  return arr.reverse();
}
