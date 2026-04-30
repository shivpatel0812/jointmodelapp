import { getChat } from "./firestore/chats";
import { loadRecentMessages } from "./firestore/messages";
import { getProject } from "./firestore/projects";
import { getUserSettings } from "./firestore/settings";
import type {
  BranchContextBlock,
  BranchSource,
  Chat,
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

/** Skip the seed branch-context system message; it's redundant with branch_context. */
function isBranchSeedMessage(m: ChatMessage): boolean {
  return m.role === "system" && m.mode === ("branch_context" as ChatMessage["mode"]);
}

const BRANCH_FIELD_LIMIT = 6_000;
const BRANCH_SIBLING_LIMIT = 5;
const BRANCH_SIBLING_CHARS = 1_500;
const BRANCH_PIPELINE_LIMIT = 1_800;

/**
 * Compress a stored `BranchSource` into the `BranchContextBlock` shape sent
 * to the backend. We keep the wire payload small because every prompt in a
 * branch chat carries it.
 */
function buildBranchContextBlock(
  source: BranchSource,
  parentChatSummary: string | null,
): BranchContextBlock {
  const siblings =
    source.siblingResponses
      ?.slice(0, BRANCH_SIBLING_LIMIT)
      .map((s) => ({
        model_label: s.modelLabel,
        response: truncate(s.response, BRANCH_SIBLING_CHARS) ?? "",
      }))
      .filter((s) => s.response.length > 0) ?? [];

  let pipelineSummary: string | null = null;
  if (source.pipelineTrace) {
    const lines = [
      `status: ${source.pipelineTrace.status}`,
      ...source.pipelineTrace.steps.map((s) => {
        const label = s.modelLabel ? ` (${s.modelLabel})` : "";
        return `- ${s.step}${label}: ${s.summary ?? "(no summary)"}`;
      }),
      source.pipelineTrace.finalAnswer
        ? `final answer: ${source.pipelineTrace.finalAnswer}`
        : "",
    ].filter(Boolean);
    pipelineSummary = truncate(lines.join("\n"), BRANCH_PIPELINE_LIMIT);
  }

  return {
    source_model_label: source.sourceModelLabel,
    source_model_id: source.sourceModelId,
    source_chat_id: source.sourceChatId,
    parent_chat_summary: truncate(parentChatSummary, 4_000),
    original_prompt: truncate(source.originalPrompt, BRANCH_FIELD_LIMIT) ?? "",
    selected_response: truncate(source.selectedResponse, BRANCH_FIELD_LIMIT) ?? "",
    sibling_responses: siblings.length > 0 ? siblings : undefined,
    judge_summary: truncate(source.judgeSummary ?? null, 4_000),
    final_synthesis: truncate(source.finalSynthesis ?? null, BRANCH_FIELD_LIMIT),
    pipeline_trace_summary: pipelineSummary,
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

  const recent_messages = recent
    .filter((m) => !isBranchSeedMessage(m))
    .map(toContextMessage);

  // Pull the parent chat summary for branch chats so the model can see the
  // arc of the original conversation, not just the selected response.
  let branchContextBlock: BranchContextBlock | null = null;
  if (chat?.isBranch && chat.branchSource) {
    let parentSummary: string | null = null;
    if (chat.parentChatId) {
      try {
        const parent: Chat | null = await getChat(uid, chat.parentChatId);
        parentSummary = parent?.summary ?? null;
      } catch {
        parentSummary = null;
      }
    }
    branchContextBlock = buildBranchContextBlock(chat.branchSource, parentSummary);
  }

  const context: ContextBlock = {
    project_title: project?.title?.trim() || null,
    project_summary: truncate(project?.currentSummary ?? null, 6_000),
    chat_summary: truncate(chat?.summary ?? null, 6_000),
    recent_messages,
    project_decisions: (project?.decisions ?? []).slice(0, 12),
    open_questions: (project?.openQuestions ?? []).slice(0, 8),
    user_preferences: truncate(settings.preferences ?? null, 1_500),
    branch_context: branchContextBlock,
  };

  const hasContent = Boolean(
    context.project_summary ||
      context.chat_summary ||
      context.recent_messages.length > 0 ||
      context.project_decisions.length > 0 ||
      context.open_questions.length > 0 ||
      context.user_preferences ||
      context.branch_context,
  );

  return { context, hasContent };
}
