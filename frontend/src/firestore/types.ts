import type { Timestamp } from "firebase/firestore";
import type {
  EvaluationResult,
  FailedAttempt,
  ModelOutput,
  ModelScore,
  PipelineResult,
  PipelineStepResult,
} from "../api";

export type RunMode = "compare" | "synthesize" | "pipeline";

export type Project = {
  id: string;
  title: string;
  description: string;
  techStack: string[];
  currentSummary: string;
  features: string[];
  decisions: string[];
  openQuestions: string[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

/** Sibling response captured at branch creation time (compact copy). */
export type BranchSourceSibling = {
  modelId: string;
  modelLabel: string;
  provider?: string | null;
  response: string;
};

/**
 * Snapshot of the slice of a parent run that seeds a branch chat.
 *
 * Stored on `Chat` when the chat was created via "Continue from this response".
 * TODO(memory): once `sourceRunId` is reliably linked, lazy-load full pipeline
 * trace / sibling responses instead of storing compact copies here.
 */
export type BranchSource = {
  type: "model_response";
  sourceChatId: string;
  sourceRunId?: string | null;
  sourceMessageId?: string | null;
  sourceModelId: string;
  sourceModelLabel: string;
  sourceProvider?: string | null;
  originalPrompt: string;
  selectedResponse: string;
  siblingResponses: BranchSourceSibling[];
  judgeSummary?: string | null;
  finalSynthesis?: string | null;
  /** Compact pipeline trace (status + final answer + step labels). */
  pipelineTrace?: {
    status: string;
    finalAnswer?: string | null;
    steps: { step: string; modelLabel?: string | null; summary?: string | null }[];
  } | null;
  createdAt: Timestamp | null;
};

export type Chat = {
  id: string;
  projectId: string | null;
  title: string;
  summary: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /** Optional: present when this chat was created via "Continue from response". */
  parentChatId?: string | null;
  isBranch?: boolean;
  branchSource?: BranchSource | null;
};

/** Stored with chat messages — no raw image bytes (TODO: Firebase Storage URLs). */
export type AttachmentMeta = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** Extra system-message modes that don't represent a user-driven RunMode. */
export type SystemMessageMode = "branch_context";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelId: string | null;
  mode: RunMode | SystemMessageMode | null;
  createdAt: Timestamp | null;
  latencyMs: number | null;
  tokenCount: number | null;
  costEstimate: number | null;
  attachments?: AttachmentMeta[] | null;
  /** Optional metadata (e.g. branch_context system message). */
  metadata?: Record<string, unknown> | null;
};

export type ContextMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  model_id: string | null;
};

/** Branch slice forwarded with the ContextBlock for branch chats. */
export type BranchContextBlock = {
  source_model_label: string;
  source_model_id: string;
  source_chat_id: string;
  parent_chat_summary?: string | null;
  original_prompt: string;
  selected_response: string;
  sibling_responses?: { model_label: string; response: string }[];
  judge_summary?: string | null;
  final_synthesis?: string | null;
  pipeline_trace_summary?: string | null;
};

/**
 * Compact memory snapshot built on the client and forwarded to the backend in
 * every model request. The backend formats it into a "PROJECT CONTEXT / CHAT
 * SUMMARY / RECENT MESSAGES / CURRENT USER PROMPT" block.
 *
 * TODO(retrieval): when we add embeddings/vector search, augment this with
 * semantically relevant older messages instead of pure recency only.
 */
export type ContextBlock = {
  project_title: string | null;
  project_summary: string | null;
  chat_summary: string | null;
  recent_messages: ContextMessage[];
  project_decisions: string[];
  open_questions: string[];
  user_preferences: string | null;
  /** Present when the active chat is a branch — backend prefixes prompts with this. */
  branch_context?: BranchContextBlock | null;
};

export type StoredJudgeResult = {
  winner_model_id: string;
  rationale: string;
  scores: Record<string, ModelScore>;
  final_synthesis: string | null;
  judge_model_id: string;
};

export type StoredPipelineTrace = {
  status: PipelineResult["status"];
  final_answer: string | null;
  trace: PipelineStepResult[];
};

export type ModelRun = {
  id: string;
  mode: RunMode;
  prompt: string;
  selectedModels: string[];
  finalAnswer: string | null;
  judgeResult: StoredJudgeResult | null;
  pipelineTrace: StoredPipelineTrace | null;
  failedAttempts: FailedAttempt[];
  outputs: ModelOutput[] | null;
  evaluation: EvaluationResult | null;
  createdAt: Timestamp | null;
};

export type UserSettings = {
  /** Free-form text the user can edit; surfaces in ContextBlock.user_preferences. */
  preferences?: string;
  defaultProjectId?: string | null;
  defaultMode?: RunMode;
};

export type UserProfile = {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};
