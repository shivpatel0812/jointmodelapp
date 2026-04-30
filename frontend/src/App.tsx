import {
  type User,
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluateResponses,
  fetchModels,
  generateParallel,
  runPipeline,
  type EvaluationResult,
  type FailedAttempt,
  type ModelInfo,
  type ModelOutput,
  type PipelineResult,
  type PipelineStepResult,
} from "./api";
import { AppSidebar } from "./components/AppSidebar";
import { ChatThread } from "./components/ChatThread";
import { MarkdownContent } from "./components/MarkdownContent";
import { PromptAttachments } from "./components/PromptAttachments";
import {
  CompareRunResultsDashboard,
  SynthesisResultsDashboard,
} from "./components/SynthesisResultsDashboard";
import {
  attachmentSummaryMeta,
  toImagePayloads,
  type LocalAttachment,
} from "./promptAttachments";
import { buildContextForPrompt } from "./context";
import { type SavedRun, loadRecentRuns, makeSummary, saveRun } from "./db";
import { loadMessages } from "./firestore/messages";
import type { Chat, ChatMessage, Project, RunMode } from "./firestore/types";
import { auth, finalizeRedirectSignIn, googleProvider } from "./firebase";
import {
  recordCompareOutputs,
  recordPipelineFinal,
  recordProjectRun,
  recordSynthesis,
  recordUserMessage,
  refreshRollingSummary,
  shouldRefreshSummary,
} from "./memory";

function describeAuthRedirectError(e: unknown): string {
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
  if (code === "auth/unauthorized-domain") {
    return (
      "This site’s URL is not allowed for Firebase sign-in. In Firebase Console → Authentication → " +
      "Settings → Authorized domains, add exactly what you use in the address bar (both " +
      "`localhost` and `127.0.0.1` if you switch between them), then try again."
    );
  }
  if (code === "auth/operation-not-supported-in-this-environment") {
    return (
      "Sign-in is not supported in this embedded browser. Open the app in Chrome, Safari, or Firefox."
    );
  }
  if (code === "auth/web-storage-unsupported" || code === "auth/storage-unavailable") {
    return "The browser blocked storage needed to stay signed in. Allow cookies/site data for this origin.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Google sign-in is disabled for this Firebase project. Enable it under Authentication → Sign-in method.";
  }
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function briefErrorReason(raw: string): string {
  const line = raw.split("\n")[0]?.trim() || raw.trim();
  if (line.length <= 240) return line;
  return `${line.slice(0, 237)}…`;
}

function buildRunAttachmentNote(outputs: ModelOutput[], imageCount: number): string | null {
  if (imageCount <= 0) return null;
  const processed = outputs.filter(
    (o) =>
      !o.skipped &&
      !o.error &&
      typeof o.attachment_note === "string" &&
      o.attachment_note.startsWith("Images used"),
  );
  const skippedImg = outputs.filter(
    (o) =>
      o.skipped &&
      (o.skip_reason?.includes("image input") ||
        o.skip_reason?.includes("does not support image")),
  );
  return [
    `The user included ${imageCount} image attachment(s).`,
    `Models that processed the images: ${processed.map((o) => `${o.label} (${o.model_id})`).join(", ") || "(none)"}.`,
    skippedImg.length > 0
      ? `Skipped or did not receive images: ${skippedImg.map((o) => `${o.label}: ${o.skip_reason ?? ""}`).join("; ")}.`
      : "",
    "Score candidates fairly given unequal inputs where applicable.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTs(ts: { toDate(): Date } | null): string {
  if (!ts) return "";
  try {
    return ts.toDate().toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function PipelineModelSelect({
  id,
  label,
  value,
  models,
  optional = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  models: ModelInfo[];
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {optional ? <option value="">No verifier</option> : null}
        {models.map((m) => (
          <option key={`${id}-${m.model_id}`} value={m.model_id}>
            {m.label} ({m.provider})
          </option>
        ))}
      </select>
    </label>
  );
}

function PipelineStepCard({ step }: { step: PipelineStepResult }) {
  const failed = !!step.error && !step.skipped;
  const title = step.step[0]?.toUpperCase() + step.step.slice(1);
  return (
    <details
      open={false}
      className={`rounded-xl border bg-slate-900/60 shadow-lg shadow-black/20 ${
        failed
          ? "border-red-900/50"
          : step.skipped
            ? "border-amber-900/40"
            : "border-slate-800"
      }`}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
            failed
              ? "bg-red-500/20 text-red-200 ring-1 ring-red-500/40"
              : step.skipped
                ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                : "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25"
          }`}
        >
          {failed ? "Failed" : step.skipped ? "Skipped" : "Done"}
        </span>
        <h3 className="font-semibold text-slate-100">{title}</h3>
        {step.label ? <span className="text-xs text-slate-500">{step.label}</span> : null}
        {step.model_id ? (
          <span className="font-mono text-xs text-slate-600">{step.model_id}</span>
        ) : null}
        {step.latency_ms != null ? (
          <span className="ml-auto font-mono text-xs text-slate-500">
            {step.latency_ms.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms
          </span>
        ) : null}
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        {step.attachment_note ? (
          <p className="mb-3 text-xs text-slate-400">{step.attachment_note}</p>
        ) : null}
        {failed || step.skipped ? (
          <p className={failed ? "text-sm text-red-200" : "text-sm text-amber-200"}>
            {briefErrorReason(step.error ?? step.skip_reason ?? "Step did not run")}
          </p>
        ) : null}
        {step.structured ? (
          <div className="mb-4 space-y-3">
            {Object.entries(step.structured).map(([key, value]) => (
              <div key={key}>
                <p className="mb-1 font-mono text-xs uppercase tracking-wide text-slate-500">
                  {key}
                </p>
                {Array.isArray(value) ? (
                  <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
                    {value.length === 0 ? (
                      <li className="text-slate-500">None listed</li>
                    ) : (
                      value.map((v, i) => <li key={`${key}-${i}`}>{String(v)}</li>)
                    )}
                  </ul>
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-slate-300">
                    {String(value)}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {step.content ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200">
            {step.content}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function HistoryPanel({
  runs,
  loading,
  onSelect,
  onClose,
}: {
  runs: SavedRun[];
  loading: boolean;
  onSelect: (run: SavedRun) => void;
  onClose?: () => void;
}) {
  const modeColors: Record<string, string> = {
    compare: "bg-blue-500/15 text-blue-300",
    synthesize: "bg-amber-500/15 text-amber-300",
    pipeline: "bg-teal-500/15 text-teal-300",
  };
  return (
    <section className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/30">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-100">Run history</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            Close
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-zinc-500">No saved runs yet. Runs are saved after each completion.</p>
      ) : (
        <ol className="space-y-2">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900/60"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${modeColors[run.mode] ?? "bg-zinc-700 text-zinc-400"}`}
                  >
                    {run.mode}
                  </span>
                  <span className="text-xs text-zinc-500">{formatTs(run.created_at)}</span>
                </div>
                <p className="truncate text-sm font-medium text-zinc-200">{run.prompt}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{run.summary}</p>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export default function App() {
  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  // History
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Project + chat memory
  const [project, setProject] = useState<Project | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [contextActive, setContextActive] = useState(false);
  const [pcRefresh, setPcRefresh] = useState(0);

  // Models
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Run state
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [outputs, setOutputs] = useState<ModelOutput[] | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [mode, setMode] = useState<RunMode>("compare");
  const [pipelineModels, setPipelineModels] = useState({
    draft: "",
    critic: "",
    improver: "",
    verifier: "",
    final: "",
  });
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowModelPicker(false);
  }, [mode]);

  useEffect(() => {
    if (!showModelPicker) return;
    const close = (e: MouseEvent) => {
      const el = modelPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showModelPicker]);

  // Finish redirect OAuth once per page load, then subscribe (Strict Mode–safe).
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    void (async () => {
      try {
        await finalizeRedirectSignIn();
        if (!cancelled) setAuthError(null);
      } catch (e: unknown) {
        if (!cancelled) setAuthError(describeAuthRedirectError(e));
      }
      if (cancelled) return;
      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Load history when user signs in / out
  useEffect(() => {
    if (!user) {
      setHistory([]);
      setProject(null);
      setChat(null);
      setMessages([]);
      return;
    }
    setHistoryLoading(true);
    loadRecentRuns(user.uid)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [user]);

  // Load saved messages whenever the active chat changes.
  useEffect(() => {
    if (!user || !chat) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    loadMessages(user.uid, chat.id)
      .then((m) => {
        if (!cancelled) setMessages(m);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, chat]);

  // Fetch available models
  useEffect(() => {
    let cancelled = false;
    fetchModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        const init: Record<string, boolean> = {};
        for (const m of list) {
          init[m.model_id] = m.available;
        }
        setSelected(init);
        const available = list.filter((m) => m.available);
        const first = available[0]?.model_id ?? "";
        const second = available[1]?.model_id ?? first;
        const third = available[2]?.model_id ?? second;
        const fourth = available[3]?.model_id ?? third;
        setPipelineModels({
          draft: first,
          critic: second,
          improver: third,
          verifier: fourth,
          final: first,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setModelsError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, on]) => on).map(([id]) => id),
    [selected],
  );
  const selectedModelInfos = useMemo(
    () =>
      selectedIds
        .map((id) => models.find((m) => m.model_id === id))
        .filter((m): m is ModelInfo => m != null),
    [selectedIds, models],
  );
  const availableModels = useMemo(() => models.filter((m) => m.available), [models]);

  const draftModelMeta = useMemo(
    () => models.find((m) => m.model_id === pipelineModels.draft),
    [models, pipelineModels.draft],
  );
  const draftSupportsVision = draftModelMeta?.supports_vision ?? false;
  const hasImageAttachments = attachments.length > 0;

  const toggle = useCallback((id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }, []);

  const setPipelineModel = useCallback(
    (key: keyof typeof pipelineModels, value: string) => {
      setPipelineModels((cur) => ({ ...cur, [key]: value }));
    },
    [],
  );

  const handleSignIn = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    // Try popup first — works reliably when third-party cookies (used by redirect flow) are blocked.
    // COOP "window.closed" warnings are harmless; sign-in still completes.
    try {
      await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      setSigningIn(false);
      return;
    } catch (e: unknown) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      // Popup closed by user — leave UI alone, no error.
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        setSigningIn(false);
        return;
      }
      // If popup is blocked, fall back to redirect.
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        try {
          await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
          return;
        } catch (e2: unknown) {
          setSigningIn(false);
          setAuthError(describeAuthRedirectError(e2));
          return;
        }
      }
      setSigningIn(false);
      setAuthError(describeAuthRedirectError(e));
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut(auth);
  }, []);

  const refreshHistory = useCallback(async (uid: string) => {
    try {
      const runs = await loadRecentRuns(uid);
      setHistory(runs);
    } catch {
      // non-blocking
    }
  }, []);

  const run = useCallback(async () => {
    const trimmed = prompt.trim();
    const imagePayloads =
      attachments.length > 0 ? toImagePayloads(attachments) : null;
    if (!trimmed && (!imagePayloads || imagePayloads.length === 0)) return;
    const promptForMemory = trimmed || "(Image-only prompt)";
    const promptForContext = trimmed || "(User attached images; respond using them.)";
    setLoading(true);
    setRunError(null);
    setSaveError(null);
    setOutputs(null);
    setEvaluation(null);
    setPipelineResult(null);
    setContextActive(false);
    let finalOutputs: ModelOutput[] | null = null;
    let finalEvaluation: EvaluationResult | null = null;
    let finalPipeline: PipelineResult | null = null;
    try {
      // Build the compact context block from Firestore (when signed in).
      let contextBlock = null;
      if (user) {
        try {
          const built = await buildContextForPrompt(
            user.uid,
            project?.id ?? null,
            chat?.id ?? null,
            promptForContext,
          );
          if (built.hasContent) {
            contextBlock = built.context;
            setContextActive(true);
          }
        } catch {
          // Context retrieval is best-effort; fall back to no context.
        }
      }

      // Save the user's message immediately (gives the thread a record even if
      // the run errors out later).
      if (user && chat) {
        await recordUserMessage(user.uid, chat.id, promptForMemory, mode, {
          attachments:
            attachments.length > 0 ? attachmentSummaryMeta(attachments) : undefined,
        }).catch(() => {
          /* best-effort */
        });
      }

      if (mode === "pipeline") {
        const result = await runPipeline(
          trimmed,
          {
            draft_model_id: pipelineModels.draft,
            critic_model_id: pipelineModels.critic,
            improver_model_id: pipelineModels.improver,
            verifier_model_id: pipelineModels.verifier || null,
            final_model_id: pipelineModels.final,
          },
          contextBlock,
          imagePayloads,
        );
        finalPipeline = result;
        setPipelineResult(result);
        if (user && chat) {
          await recordPipelineFinal(user.uid, chat.id, mode, result).catch(() => {
            /* best-effort */
          });
        }
      } else {
        const results = await generateParallel(trimmed, selectedIds, contextBlock, imagePayloads);
        finalOutputs = results;
        setOutputs(results);
        if (user && chat) {
          await recordCompareOutputs(user.uid, chat.id, mode, results).catch(() => {
            /* best-effort */
          });
        }
        if (mode === "synthesize") {
          const failedAttempts: FailedAttempt[] = results
            .filter((r) => r.skipped || r.error)
            .map((r) => ({
              model_id: r.model_id,
              label: r.label,
              reason: r.skipped
                ? (r.skip_reason ?? "Model was skipped")
                : (r.error ?? "Unknown error"),
            }));
          const candidates = results
            .filter((r) => !r.skipped && !r.error && (r.content?.trim().length ?? 0) > 0)
            .map((r) => ({
              model_id: r.model_id,
              label: r.label,
              content: r.content!.trim(),
              latency_ms: r.latency_ms ?? null,
              input_note: r.attachment_note ?? null,
            }));
          if (candidates.length === 0) {
            setRunError("Nothing to judge: every selected model failed or was skipped.");
          } else {
            const runNote = buildRunAttachmentNote(results, attachments.length);
            const ev = await evaluateResponses(trimmed, candidates, failedAttempts, {
              include_synthesis: true,
              context: contextBlock,
              run_attachment_note: runNote ?? undefined,
            });
            finalEvaluation = ev;
            setEvaluation(ev);
            if (user && chat) {
              await recordSynthesis(user.uid, chat.id, mode, ev).catch(() => {
                /* best-effort */
              });
            }
          }
        }
      }

      // Persist a structured run + reload the thread / refresh history.
      if (user) {
        if (project) {
          await recordProjectRun(user.uid, project.id, {
            mode,
            prompt: promptForMemory,
            selectedModels:
              mode === "pipeline"
                ? [
                    pipelineModels.draft,
                    pipelineModels.critic,
                    pipelineModels.improver,
                    ...(pipelineModels.verifier ? [pipelineModels.verifier] : []),
                    pipelineModels.final,
                  ]
                : selectedIds,
            outputs: finalOutputs,
            evaluation: finalEvaluation,
            pipelineResult: finalPipeline,
          }).catch(() => setSaveError("Run complete — saving project run failed."));
        }

        // Legacy flat history (kept so existing users still see "Run history").
        const runData = {
          prompt: promptForMemory,
          mode,
          outputs: finalOutputs,
          evaluation: finalEvaluation,
          pipelineResult: finalPipeline,
          summary: makeSummary({
            prompt: promptForMemory,
            mode,
            outputs: finalOutputs,
            evaluation: finalEvaluation,
            pipelineResult: finalPipeline,
          }),
        };
        saveRun(user.uid, runData)
          .then(() => refreshHistory(user.uid))
          .catch(() => setSaveError("Run complete — but saving to history failed."));

        if (chat) {
          // Reload thread so the new turn shows up.
          loadMessages(user.uid, chat.id)
            .then((m) => {
              setMessages(m);
              if (shouldRefreshSummary(m.length)) {
                void refreshRollingSummary(user.uid, chat, project).then(() =>
                  setPcRefresh((n) => n + 1),
                );
              }
            })
            .catch(() => {
              /* keep existing messages */
            });
        }
      }
    } catch (e: unknown) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    prompt,
    attachments,
    selectedIds,
    mode,
    pipelineModels,
    user,
    project,
    chat,
    refreshHistory,
  ]);

  const handleHistorySelect = useCallback((run: SavedRun) => {
    setPrompt(run.prompt);
    setMode(run.mode);
    setOutputs(run.outputs ?? null);
    setEvaluation(run.evaluation ?? null);
    setPipelineResult(run.pipelineResult ?? null);
    setRunError(null);
    setSaveError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const anyConfigured = models.some((m) => m.available);

  const breadcrumbProject = project?.title ?? "—";
  const breadcrumbChat = chat?.title ?? "New thread";

  return (
    <div
      className={
        user && !authLoading
          ? "flex min-h-screen bg-[#0c0c0e]"
          : "min-h-screen bg-[#0c0c0e]"
      }
    >
      {user && !authLoading ? (
        <AppSidebar
          uid={user.uid}
          displayName={user.displayName}
          photoURL={user.photoURL}
          projectId={project?.id ?? null}
          chatId={chat?.id ?? null}
          onSelectProject={setProject}
          onSelectChat={setChat}
          onSignOut={() => void handleSignOut()}
          onOpenHistory={() => setShowHistory(true)}
          refreshKey={pcRefresh}
        />
      ) : null}

      <div
        className={
          user && !authLoading
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto"
            : "mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-8"
        }
      >
      <div
        className={
          user && !authLoading
            ? "mx-auto w-full max-w-4xl px-6 pb-24 pt-6 sm:px-10"
            : ""
        }
      >
        {/* Signed-out header */}
        {!user || authLoading ? (
          <header className="mb-10">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-widest text-blue-400/90">
                  Joint Model · v1
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Multi-model responses and joint pipeline
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-zinc-500">
                  Compare models side by side, synthesize answers, or run a draft → critique →
                  improve workflow.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1">
                {!authLoading && user === null ? (
                  <button
                    type="button"
                    onClick={() => setShowHistory(true)}
                    className="rounded-xl border border-zinc-700 bg-transparent px-3 py-2 text-sm font-medium text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    History
                  </button>
                ) : null}
                {authLoading ? null : (
                  <button
                    type="button"
                    onClick={() => void handleSignIn()}
                    disabled={signingIn}
                    className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {signingIn ? "Redirecting…" : "Sign in with Google"}
                  </button>
                )}
              </div>
            </div>
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500">
              Sign in for saved projects, chats, and context across sessions.
            </p>
            {authError ? (
              <div className="mt-3 rounded-xl border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                {authError}
              </div>
            ) : null}
          </header>
        ) : (
          <>
            <nav className="mb-2 text-xs text-zinc-500">
              <span className="text-zinc-400">{breadcrumbProject}</span>
              <span className="mx-1.5 text-zinc-600">/</span>
              <span className="text-zinc-300">{breadcrumbChat}</span>
            </nav>
            <header className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Multi-model responses and joint pipeline
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
                Compare models side-by-side, synthesize the strongest successful answers, or run a
                sequential draft → critique → improve → verify → final workflow.
              </p>
            </header>
            {authError ? (
              <div className="mb-4 rounded-xl border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                {authError}
              </div>
            ) : null}
            {user && chat ? (
              <details className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/30">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300">
                  Chat messages ({messages.length})
                </summary>
                <div className="border-t border-zinc-800 px-2 pb-2">
                  <ChatThread
                    chat={chat}
                    messages={messages}
                    loading={messagesLoading}
                    embedded
                  />
                </div>
              </details>
            ) : null}
          </>
        )}

      {/* Run controls */}
      <section className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl shadow-black/30">
        <PromptAttachments
          attachments={attachments}
          onChange={setAttachments}
          onError={setAttachmentError}
        >
          <label htmlFor="prompt" className="mb-2 block text-sm font-medium text-zinc-300">
            Prompt
          </label>
          <textarea
            id="prompt"
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask something… Drag images onto this box to attach them."
            className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950/80 px-3 py-2.5 font-sans text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </PromptAttachments>
        {attachmentError ? (
          <p className="mt-2 text-sm text-amber-400/95">{attachmentError}</p>
        ) : null}

        {/* Mode selector */}
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-zinc-300">Mode</p>
          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                ["compare", "Compare", "Run several models independently."],
                [
                  "synthesize",
                  "Synthesize",
                  "Run, then draft-merge successful answers.",
                ],
                [
                  "pipeline",
                  "Joint pipeline",
                  "Draft, critique & improve in sequence + verify or final.",
                ],
              ] as [RunMode, string, string][]
            ).map(([id, title, desc]) => (
              <label
                key={id}
                className={`cursor-pointer rounded-xl border px-4 py-3 text-sm transition-colors ${
                  mode === id
                    ? "border-blue-500/70 bg-blue-500/10 ring-1 ring-blue-500/30"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={id}
                  checked={mode === id}
                  onChange={() => setMode(id)}
                  className="sr-only"
                />
                <span className="block font-medium text-zinc-100">{title}</span>
                <span className="mt-1 block text-xs text-zinc-500">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Model selection */}
        {mode === "pipeline" ? (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="mb-3 text-sm font-medium text-zinc-300">Pipeline models</p>
            {modelsError ? (
              <p className="text-sm text-red-400">{modelsError}</p>
            ) : availableModels.length === 0 ? (
              <p className="text-sm text-zinc-500">No available models yet.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    ["draft-model", "Draft", "draft"],
                    ["critic-model", "Critique", "critic"],
                    ["improver-model", "Improve", "improver"],
                    ["verifier-model", "Verify", "verifier"],
                    ["final-model", "Final", "final"],
                  ] as [string, string, keyof typeof pipelineModels][]
                ).map(([htmlId, label, key]) => (
                  <PipelineModelSelect
                    key={htmlId}
                    id={htmlId}
                    label={label}
                    value={pipelineModels[key]}
                    models={availableModels}
                    optional={key === "verifier"}
                    onChange={(v) => setPipelineModel(key, v)}
                  />
                ))}
              </div>
            )}
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Every step includes the original prompt. Verify is optional — if it fails, the
              final step continues with a caution note.
            </p>
            {hasImageAttachments ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                  draftSupportsVision
                    ? "border-emerald-900/50 bg-emerald-950/25 text-emerald-200/90"
                    : "border-amber-800/60 bg-amber-950/30 text-amber-200/95"
                }`}
              >
                {draftSupportsVision ? (
                  <>
                    Image prompt detected. Draft uses a vision-capable model — images are passed
                    to draft (and to verify when that model supports vision).
                  </>
                ) : (
                  <>
                    Image attachments require a vision-capable Draft model. Choose a model marked
                    with vision support, or remove images to run the pipeline.
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative mt-6" ref={modelPickerRef}>
            <p className="mb-2 text-sm font-medium text-zinc-300">Models</p>
            {modelsError ? (
              <p className="text-sm text-red-400">{modelsError}</p>
            ) : models.length === 0 ? (
              <p className="text-sm text-zinc-500">Loading models…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedModelInfos.map((m) => (
                    <span
                      key={m.model_id}
                      className={`inline-flex items-center gap-1 rounded-full border bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 ${
                        hasImageAttachments && !m.supports_vision
                          ? "border-amber-700/70 ring-1 ring-amber-600/25"
                          : "border-zinc-600"
                      }`}
                    >
                      {m.label}
                      {hasImageAttachments ? (
                        m.supports_vision ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-emerald-300/90">
                            Vision
                          </span>
                        ) : (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-amber-200/90">
                            Text only
                          </span>
                        )
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove ${m.label}`}
                        onClick={() => toggle(m.model_id)}
                        className="ml-0.5 rounded-md px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowModelPicker((s) => !s)}
                    className="rounded-full border border-dashed border-zinc-600 px-3 py-1.5 text-sm font-medium text-zinc-400 transition hover:border-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    + Choose models
                  </button>
                </div>
                {showModelPicker ? (
                  <div className="absolute left-0 top-full z-20 mt-2 w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black/50">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Available models
                    </p>
                    <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                      {models.map((m) => (
                        <li key={m.model_id}>
                          <label
                            className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm ${
                              m.available ? "hover:bg-zinc-900" : "cursor-not-allowed opacity-45"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-500"
                              checked={!!selected[m.model_id]}
                              disabled={!m.available}
                              onChange={() => toggle(m.model_id)}
                            />
                            <span className="font-medium text-zinc-200">{m.label}</span>
                            <span className="text-xs text-zinc-600">{m.provider}</span>
                            {hasImageAttachments && m.available ? (
                              m.supports_vision ? (
                                <span className="text-[10px] text-emerald-500/90">Vision</span>
                              ) : (
                                <span className="text-[10px] text-amber-500/90">
                                  Images not supported
                                </span>
                              )
                            ) : null}
                            {!m.available && m.unavailable_reason ? (
                              <span className="text-xs text-amber-500">({m.unavailable_reason})</span>
                            ) : null}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={
              loading ||
              (!prompt.trim() && attachments.length === 0) ||
              !anyConfigured ||
              (mode === "pipeline" &&
                hasImageAttachments &&
                !draftSupportsVision) ||
              (mode === "pipeline"
                ? !pipelineModels.draft ||
                  !pipelineModels.critic ||
                  !pipelineModels.improver ||
                  !pipelineModels.final
                : selectedIds.length === 0)
            }
            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none"
          >
            {loading
              ? mode === "pipeline"
                ? "Running pipeline…"
                : mode === "synthesize"
                  ? "Running & judging…"
                  : "Running…"
              : !loading &&
                  ((outputs?.length ?? 0) > 0 ||
                    evaluation !== null ||
                    pipelineResult !== null)
                ? "Run again"
                : mode === "pipeline"
                  ? "Run joint pipeline"
                  : mode === "synthesize"
                    ? "Run & synthesize"
                    : "Run selected"}
          </button>
          {!anyConfigured && models.length > 0 ? (
            <span className="text-sm text-amber-400/90">
              Add API keys in{" "}
              <code className="font-mono text-xs text-zinc-400">backend/.env</code> to enable models.
            </span>
          ) : null}
          {user ? (
            <span className="text-xs text-zinc-500">Runs saved to your account.</span>
          ) : (
            <span className="text-xs text-zinc-600">Sign in to save runs.</span>
          )}
          {contextActive ? (
            <span
              title="Project + chat memory was attached to this run's prompts."
              className="rounded-full border border-emerald-700/60 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-200"
            >
              Using saved context
            </span>
          ) : null}
        </div>
      </section>

      {/* Errors */}
      {runError ? (
        <div className="mb-6 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {runError}
        </div>
      ) : null}
      {saveError ? (
        <div className="mb-6 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-300">
          {saveError}
        </div>
      ) : null}

      {/* Pipeline result */}
      {pipelineResult ? (
        <section className="mb-10 space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-500/25">
              Pipeline {pipelineResult.status}
            </span>
            <span className="text-zinc-400">
              {pipelineResult.trace.filter((s) => !s.error && !s.skipped).length} steps OK
            </span>
          </div>
          <article className="rounded-2xl border border-teal-800/50 bg-gradient-to-b from-teal-950/25 to-zinc-950/40 p-5 shadow-xl shadow-black/25">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-teal-100">Final joint answer</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  pipelineResult.status === "completed"
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25"
                    : pipelineResult.status === "partial"
                      ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/40"
                      : "bg-red-500/20 text-red-200 ring-1 ring-red-500/40"
                }`}
              >
                {pipelineResult.status}
              </span>
            </div>
            <p className="mb-3 text-xs text-teal-200/70">
              Draft → critique → improve → verify → final. Markdown rendered below.
            </p>
            {pipelineResult.trace.some((s) =>
              (s.attachment_note ?? "").includes("Images used"),
            ) ? (
              <p className="mb-3 text-xs text-teal-300/85">
                Draft (and verify when vision-capable) received image attachments; later steps use
                text from prior stages.
              </p>
            ) : null}
            <div className="rounded-xl border border-slate-800/80 bg-slate-950/70 px-4 py-4">
              {pipelineResult.final_answer ? (
                <MarkdownContent markdown={pipelineResult.final_answer} />
              ) : (
                <p className="text-sm text-slate-400">
                  Pipeline did not produce a final answer. Expand the trace below.
                </p>
              )}
            </div>
          </article>

          <section>
            <h2 className="mb-4 text-lg font-semibold text-slate-100">Pipeline trace</h2>
            <p className="mb-3 text-xs text-zinc-500">Steps are collapsed — expand to inspect.</p>
            <div className="space-y-3">
              {pipelineResult.trace.map((step, i) => (
                <PipelineStepCard key={`${step.step}-${i}`} step={step} />
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {/* Synthesize: polished dashboard (final answer first, judge, leaderboard, …) */}
      {evaluation && outputs && outputs.length > 0 ? (
        <SynthesisResultsDashboard
          outputs={outputs}
          evaluation={evaluation}
          models={models}
          hasImageAttachments={hasImageAttachments}
          projectSelected={project !== null}
          userSignedIn={user !== null}
        />
      ) : outputs && outputs.length > 0 && !pipelineResult ? (
        <CompareRunResultsDashboard
          outputs={outputs}
          models={models}
          hasImageAttachments={hasImageAttachments}
        />
      ) : null}

      {/* History panel */}
      {user && showHistory ? (
        <HistoryPanel
          runs={history}
          loading={historyLoading}
          onSelect={handleHistorySelect}
          onClose={() => setShowHistory(false)}
        />
      ) : null}
      </div>

      <button
        type="button"
        title="Joint Model: compare multiple LLMs, synthesize, or run the joint pipeline. API keys live on the backend only."
        className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-lg font-medium text-zinc-400 shadow-lg shadow-black/40 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
        aria-label="Help"
      >
        ?
      </button>
      </div>
    </div>
  );
}
