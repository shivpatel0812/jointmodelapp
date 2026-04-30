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

export type Chat = {
  id: string;
  projectId: string | null;
  title: string;
  summary: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  modelId: string | null;
  mode: RunMode | null;
  createdAt: Timestamp | null;
  latencyMs: number | null;
  tokenCount: number | null;
  costEstimate: number | null;
};

export type ContextMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  model_id: string | null;
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
