import { getChat } from "./firestore/chats";
import { loadRecentMessages } from "./firestore/messages";
import { getProject } from "./firestore/projects";
import { getUserSettings } from "./firestore/settings";
import type {
  ChatMessage,
  ContextBlock,
  ContextMessage,
  UserSettings,
} from "./firestore/types";

const RECENT_MESSAGES = 10; // 8–12 per spec; keep compact.
const PER_MESSAGE_CHARS = 1_200;

function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function toContextMessage(m: ChatMessage): ContextMessage {
  return {
    role: m.role,
    content: truncate(m.content, PER_MESSAGE_CHARS) ?? "",
    model_id: m.modelId ?? null,
  };
}

/**
 * Assemble a compact ContextBlock for a prompt. All retrieval happens here on
 * the client (where the Firebase web SDK is) and the result is forwarded to
 * the backend, which formats it into the actual prompt prefix.
 *
 * Any of `projectId` / `chatId` may be null (e.g. user has not yet picked a
 * project or started a chat) — in that case we just skip the missing parts.
 *
 * TODO(retrieval): once we add embeddings, supplement `recent_messages` with
 * the most semantically relevant older messages instead of pure recency only.
 */
export async function buildContextForPrompt(
  uid: string,
  projectId: string | null,
  chatId: string | null,
  // currentPrompt is reserved for future retrieval keyed off the prompt;
  // unused today since we only use rolling summaries + recency.
  _currentPrompt: string,
): Promise<{ context: ContextBlock; hasContent: boolean }> {
  const [project, chat, recent, settings] = await Promise.all([
    projectId ? getProject(uid, projectId).catch(() => null) : Promise.resolve(null),
    chatId ? getChat(uid, chatId).catch(() => null) : Promise.resolve(null),
    chatId
      ? loadRecentMessages(uid, chatId, RECENT_MESSAGES).catch(() => [])
      : Promise.resolve([] as ChatMessage[]),
    getUserSettings(uid).catch((): UserSettings => ({})),
  ]);

  const recent_messages = recent.map(toContextMessage);

  const context: ContextBlock = {
    project_title: project?.title?.trim() || null,
    project_summary: truncate(project?.currentSummary ?? null, 6_000),
    chat_summary: truncate(chat?.summary ?? null, 6_000),
    recent_messages,
    project_decisions: (project?.decisions ?? []).slice(0, 12),
    open_questions: (project?.openQuestions ?? []).slice(0, 8),
    user_preferences: truncate(settings.preferences ?? null, 1_500),
  };

  const hasContent = Boolean(
    context.project_summary ||
      context.chat_summary ||
      context.recent_messages.length > 0 ||
      context.project_decisions.length > 0 ||
      context.open_questions.length > 0 ||
      context.user_preferences,
  );

  return { context, hasContent };
}
