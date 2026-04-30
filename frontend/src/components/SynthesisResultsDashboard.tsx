import { type ReactNode, useMemo, useState } from "react";
import type {
  EvaluationResult,
  ModelInfo,
  ModelOutput,
  ModelScore,
  PerModelJudgeNote,
} from "../api";
import { MarkdownContent } from "./MarkdownContent";

function briefErr(raw: string): string {
  const line = raw.split("\n")[0]?.trim() || raw.trim();
  return line.length <= 200 ? line : `${line.slice(0, 197)}…`;
}

function msToSec(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const s = ms / 1000;
  return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
}

function labelFor(outputs: ModelOutput[], id: string): string {
  return outputs.find((o) => o.model_id === id)?.label ?? id;
}

function providerFor(outputs: ModelOutput[], id: string): string {
  return outputs.find((o) => o.model_id === id)?.provider ?? "—";
}

function metaFor(models: ModelInfo[], modelId: string): ModelInfo | undefined {
  return models.find((m) => m.model_id === modelId);
}

function inferBestValueId(scores: Record<string, ModelScore>): string | null {
  const entries = Object.entries(scores).filter(([id]) =>
    /mini|flash|haiku|nano|lite/i.test(id),
  );
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1].overall - a[1].overall || a[0].localeCompare(b[0]));
  return entries[0][0];
}

function deriveBestForTag(
  modelId: string,
  evaluation: EvaluationResult,
  notes: PerModelJudgeNote | undefined,
): string {
  if (notes?.best_for?.trim()) return notes.best_for.trim();
  if (modelId === evaluation.winner_model_id) return "Best overall";
  if (modelId === evaluation.highlights.fastest_model_id) return "Fastest";
  const hq = evaluation.highlights.best_quality_model_id;
  if (hq && modelId === hq) return "Best quality";
  return "—";
}

function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "emerald" | "amber" | "sky" | "violet" | "rose";
}) {
  const tones: Record<string, string> = {
    slate: "border-zinc-600 bg-zinc-900/80 text-zinc-300",
    emerald: "border-emerald-700/50 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-700/50 bg-amber-500/10 text-amber-200",
    sky: "border-sky-700/50 bg-sky-500/10 text-sky-200",
    violet: "border-violet-700/50 bg-violet-500/10 text-violet-200",
    rose: "border-rose-700/50 bg-rose-500/10 text-rose-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function CapabilityStrip({
  info,
  score,
  latencyMs,
  isWinner,
}: {
  info: ModelInfo | undefined;
  score: ModelScore | undefined;
  latencyMs: number | null | undefined;
  isWinner: boolean;
}) {
  const cheap =
    info &&
    /mini|flash|haiku|nano|lite/i.test(info.model_id) &&
    !/gpt-4o(?!\s*mini)/i.test(info.model_id);
  const fast = latencyMs != null && latencyMs < 4500;
  const hiQ = score && score.overall >= 4;

  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone="slate">Text</Badge>
      {info?.supports_vision ? (
        <Badge tone="emerald">Vision</Badge>
      ) : (
        <Badge tone="amber">No vision</Badge>
      )}
      <Badge tone="slate">No web</Badge>
      {fast ? <Badge tone="sky">Fast</Badge> : null}
      {cheap ? <Badge tone="violet">Low cost</Badge> : null}
      {hiQ || isWinner ? <Badge tone="rose">High quality</Badge> : null}
    </div>
  );
}

function ImageStatusPill({
  row,
  hasImageAttachments,
}: {
  row: ModelOutput;
  hasImageAttachments: boolean;
}) {
  if (!hasImageAttachments) return null;
  if (row.skipped && (row.skip_reason ?? "").toLowerCase().includes("image"))
    return (
      <Badge tone="amber">Skipped (no vision)</Badge>
    );
  if (row.attachment_note?.startsWith("Images used"))
    return <Badge tone="emerald">Saw images</Badge>;
  if (!row.skipped && !row.error)
    return <Badge tone="slate">Text only</Badge>;
  return null;
}

export function SynthesisResultsDashboard({
  outputs,
  evaluation,
  models,
  hasImageAttachments,
  projectSelected,
  userSignedIn,
  onContinueFromResponse,
}: {
  outputs: ModelOutput[];
  evaluation: EvaluationResult;
  models: ModelInfo[];
  hasImageAttachments: boolean;
  projectSelected: boolean;
  userSignedIn: boolean;
  /**
   * Open the branch-chat modal for a successful response. When omitted (e.g.
   * signed-out demo), the per-card button is hidden.
   */
  onContinueFromResponse?: (output: ModelOutput) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const synthesis = evaluation.final_synthesis?.trim() ?? "";
  const scoredIds = useMemo(
    () =>
      Object.entries(evaluation.scores).sort(
        (a, b) => b[1].overall - a[1].overall || a[0].localeCompare(b[0]),
      ),
    [evaluation.scores],
  );

  const successful = outputs.filter((o) => !o.error && !o.skipped).length;
  const skippedOrFailed = outputs.filter((o) => o.skipped || o.error).length;
  const excludedCount = evaluation.excluded_failed_summary.length;

  const winnerLabel = labelFor(outputs, evaluation.winner_model_id);
  const fastestId =
    evaluation.highlights.fastest_model_id ??
    (() => {
      const pairs = outputs
        .filter((o) => o.latency_ms != null && !o.skipped && !o.error)
        .map((o) => [o.model_id, o.latency_ms!] as const);
      if (!pairs.length) return null;
      return pairs.reduce((a, b) => (a[1] <= b[1] ? a : b))[0];
    })();

  const bestValueDisplay =
    evaluation.highlights.best_value_model_id ?? inferBestValueId(evaluation.scores);

  const agreement = evaluation.model_agreement ?? { agreed: [], differed: [] };
  const strengths = evaluation.winner_strengths ?? [];
  const perNotes = evaluation.per_model_notes ?? {};

  const copySynthesis = async () => {
    if (!synthesis) return;
    try {
      await navigator.clipboard.writeText(synthesis);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const exportRun = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            evaluation,
            outputs,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `joint-model-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveHint = () => {
    if (!userSignedIn) {
      window.alert("Sign in to save runs to your account and projects.");
      return;
    }
    if (!projectSelected) {
      window.alert("Select a project in the sidebar — runs are saved when you execute them.");
      return;
    }
    window.alert(
      "Completed runs are saved automatically when you’re signed in with a project selected.",
    );
  };

  const winnerScore = evaluation.scores[evaluation.winner_model_id]?.overall ?? "—";

  return (
    <section className="mb-10 space-y-6">
      {/* Run summary strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm">
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-500/25">
          Completed
        </span>
        <span className="text-zinc-400">
          <span className="text-emerald-400">{successful}</span> successful
        </span>
        {(skippedOrFailed > 0 || excludedCount > 0) && (
          <span className="text-zinc-400">
            ·{" "}
            <span className="text-amber-400">{skippedOrFailed + excludedCount}</span> excluded /
            skipped
          </span>
        )}
        <span className="text-zinc-500">·</span>
        <span className="text-zinc-300">
          Winner:{" "}
          <span className="font-medium text-amber-100/95">{winnerLabel}</span>
        </span>
        {fastestId ? (
          <>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-400">
              Fastest:{" "}
              <span className="text-sky-300">
                {labelFor(outputs, fastestId)} ({msToSec(outputs.find((o) => o.model_id === fastestId)?.latency_ms)})
              </span>
            </span>
          </>
        ) : null}
      </div>

      {/* 1 — Final answer */}
      {synthesis ? (
        <article className="rounded-2xl border border-teal-800/45 bg-gradient-to-b from-teal-950/25 to-zinc-950/40 p-5 shadow-xl shadow-black/25">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-400/90">
                1
              </span>
              <h2 className="text-lg font-semibold text-teal-50">Final synthesized answer</h2>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 ring-1 ring-amber-500/30">
                Best answer
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copySynthesis()}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={saveHint}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Save to project
              </button>
              <button
                type="button"
                onClick={exportRun}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => setRawOpen(true)}
                className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
              >
                View raw outputs
              </button>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 [&::-webkit-details-marker]:hidden">
                  View sources ({scoredIds.length})
                </summary>
                <div className="absolute right-0 z-30 mt-1 min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950 py-2 shadow-xl">
                  <p className="px-3 pb-2 text-[10px] uppercase tracking-wide text-zinc-500">
                    Scored models
                  </p>
                  <ul className="max-h-48 overflow-y-auto text-xs text-zinc-300">
                    {scoredIds.map(([id]) => (
                      <li key={id} className="px-3 py-1 font-mono">
                        {labelFor(outputs, id)}{" "}
                        <span className="text-zinc-500">({id})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </div>
          </div>
          {hasImageAttachments ? (
            <p className="mb-3 text-xs text-teal-300/80">
              {outputs.some(
                (o) =>
                  !o.skipped &&
                  !o.error &&
                  (o.attachment_note ?? "").startsWith("Images used"),
              )
                ? "Grounded in models that saw your attachments where noted below."
                : "No scored model processed images — treat synthesis as text-relative to attachments."}
            </p>
          ) : null}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 px-4 py-4">
            <MarkdownContent markdown={synthesis} />
          </div>
        </article>
      ) : null}

      {/* 2 — Judge */}
      <article className="rounded-2xl border border-amber-900/35 bg-amber-950/15 p-5 shadow-lg shadow-black/20">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-amber-500/90">
            2
          </span>
          <h2 className="text-lg font-semibold text-amber-50">Judge decision</h2>
        </div>
        <div className="mb-4 flex flex-wrap items-stretch gap-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/20">
            <span className="text-2xl" aria-hidden>
              🏆
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-amber-200/70">Winner</p>
              <p className="font-semibold text-amber-50">{winnerLabel}</p>
              <p className="font-mono text-[11px] text-amber-200/60">{evaluation.winner_model_id}</p>
              <p className="mt-1 text-sm font-medium text-amber-200">{winnerScore}/5 overall</p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-emerald-400/80">Best quality</p>
              <p className="text-sm font-medium text-emerald-100">
                {evaluation.highlights.best_quality_model_id
                  ? labelFor(outputs, evaluation.highlights.best_quality_model_id)
                  : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-violet-400/80">Best value</p>
              <p className="text-sm font-medium text-violet-100">
                {bestValueDisplay ? labelFor(outputs, bestValueDisplay) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-sky-900/40 bg-sky-950/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-sky-400/80">Fastest</p>
              <p className="text-sm font-medium text-sky-100">
                {fastestId ? labelFor(outputs, fastestId) : "—"}
              </p>
            </div>
          </div>
        </div>

        {strengths.length > 0 ? (
          <div className="mb-4 rounded-xl border border-emerald-900/30 bg-emerald-950/10 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
              Top strengths (winner)
            </p>
            <ul className="space-y-1.5 text-sm text-emerald-100/90">
              {strengths.map((s, i) => (
                <li key={`${i}-${s.slice(0, 24)}`} className="flex gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="group rounded-xl border border-zinc-800 bg-zinc-950/40">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
            <span className="mr-2 inline-block transition group-open:rotate-90">▸</span>
            View full judge explanation
          </summary>
          <div className="border-t border-zinc-800 px-4 py-3 text-sm leading-relaxed text-zinc-300">
            <MarkdownContent markdown={evaluation.rationale} />
          </div>
        </details>
        <p className="mt-2 font-mono text-[10px] text-zinc-600">
          Judge model: {evaluation.judge_model_id}
        </p>
      </article>

      {/* 3 — Leaderboard */}
      <article className="rounded-xl border border-zinc-800/50 bg-zinc-950/25 p-4 shadow-md shadow-black/10 sm:p-5 xl:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">3</span>
          <h2 className="text-lg font-semibold text-zinc-100">Model leaderboard</h2>
        </div>
        <div className="space-y-2">
          {scoredIds.map(([id, sc], rank) => {
            const row = outputs.find((o) => o.model_id === id);
            const info = metaFor(models, id);
            const notes = perNotes[id];
            const bf = deriveBestForTag(id, evaluation, notes);
            const noteLine = notes?.note?.trim() || notes?.strength?.trim() || "—";
            return (
              <div
                key={id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 ${
                  id === evaluation.winner_model_id
                    ? "border-amber-500/35 bg-amber-500/5"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <span className="w-7 shrink-0 text-center font-mono text-sm text-zinc-500">
                  {rank + 1}
                </span>
                <div className="min-w-[120px] flex-1">
                  <p className="font-medium text-zinc-100">{labelFor(outputs, id)}</p>
                  <p className="font-mono text-[10px] text-zinc-500">{id}</p>
                </div>
                <span className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                  {providerFor(outputs, id)}
                </span>
                <div className="hidden shrink-0 md:block md:w-[140px]">
                  <CapabilityStrip
                    info={info}
                    score={sc}
                    latencyMs={row?.latency_ms}
                    isWinner={id === evaluation.winner_model_id}
                  />
                </div>
                <div className="flex min-w-[100px] flex-1 items-center gap-2 sm:max-w-[200px]">
                  <div className="h-2 flex-1 rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500/75"
                      style={{ width: `${(sc.overall / 5) * 100}%` }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-xs text-zinc-400">{sc.overall}/5</span>
                </div>
                <span className="shrink-0 text-[11px] text-violet-300/95">{bf}</span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {msToSec(row?.latency_ms)}
                </span>
                <span className="hidden max-w-[180px] truncate text-[11px] text-zinc-500 lg:inline">
                  {noteLine}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-600">
          Badges: Text (always), Vision / No vision, No web (judge has no browsing), Fast (&lt;4.5s),
          Low cost (Flash/Mini/Haiku-family IDs), High quality (overall ≥4 or winner).
        </p>
      </article>

      {/* 4 — Agreement */}
      <article className="rounded-xl border border-zinc-800/50 bg-zinc-950/25 p-4 shadow-md shadow-black/10 sm:p-5 xl:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">4</span>
          <h2 className="text-lg font-semibold text-zinc-100">Model agreement & differences</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-900/35 bg-emerald-950/15 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
              Where models agreed
            </p>
            {agreement.agreed.length ? (
              <ul className="list-inside list-disc space-y-1.5 text-sm text-emerald-100/85">
                {agreement.agreed.map((line, i) => (
                  <li key={`a-${i}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No agreement summary from judge.</p>
            )}
          </div>
          <div className="rounded-xl border border-orange-900/35 bg-orange-950/15 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-400/90">
              Where models differed
            </p>
            {agreement.differed.length ? (
              <ul className="list-inside list-disc space-y-1.5 text-sm text-orange-100/85">
                {agreement.differed.map((line, i) => (
                  <li key={`d-${i}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No differences summary from judge.</p>
            )}
          </div>
        </div>
      </article>

      {/* 5 — Individual responses */}
      <article className="rounded-xl border border-zinc-800/50 bg-zinc-950/25 p-4 shadow-md shadow-black/10 sm:p-5 xl:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">5</span>
            <h2 className="text-lg font-semibold text-zinc-100">Individual model responses</h2>
          </div>
          <span className="text-xs text-zinc-500">Collapsed — expand a card for full text</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {outputs.map((row) => {
            const sc = evaluation.scores[row.model_id];
            const notes = perNotes[row.model_id];
            const info = metaFor(models, row.model_id);
            return (
              <details
                key={`${row.model_id}-${row.label}`}
                className={`rounded-xl border bg-zinc-900/50 shadow-md shadow-black/15 ${
                  row.model_id === evaluation.winner_model_id
                    ? "border-amber-500/40"
                    : "border-zinc-800"
                }`}
              >
                <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                      {row.provider}
                    </span>
                    <span className="font-medium text-zinc-100">{row.label}</span>
                    {sc ? (
                      <span className="font-mono text-xs text-zinc-400">{sc.overall}/5</span>
                    ) : null}
                    {row.latency_ms != null ? (
                      <span className="font-mono text-xs text-zinc-500">{msToSec(row.latency_ms)}</span>
                    ) : null}
                    <ImageStatusPill row={row} hasImageAttachments={hasImageAttachments} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <CapabilityStrip
                      info={info}
                      score={sc}
                      latencyMs={row.latency_ms}
                      isWinner={row.model_id === evaluation.winner_model_id}
                    />
                  </div>
                  {notes?.strength ? (
                    <p className="mt-2 text-xs text-emerald-300/90">
                      <span className="font-semibold text-emerald-400/90">Strength: </span>
                      {notes.strength}
                    </p>
                  ) : null}
                  {notes?.weakness ? (
                    <p className="mt-1 text-xs text-rose-300/85">
                      <span className="font-semibold text-rose-400/90">Weakness: </span>
                      {notes.weakness}
                    </p>
                  ) : null}
                  <span className="mt-2 inline-block text-xs font-medium text-blue-400/95">
                    ▸ View full response
                  </span>
                </summary>
                <div className="border-t border-zinc-800 px-4 py-3">
                  {row.skipped ? (
                    <p className="text-sm text-amber-200/90">{briefErr(row.skip_reason ?? "")}</p>
                  ) : row.error ? (
                    <div>
                      <p className="text-sm text-red-200/90">{briefErr(row.error)}</p>
                      <details className="mt-2 text-xs text-zinc-500">
                        <summary className="cursor-pointer text-zinc-400">Technical details</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
                          {row.error}
                        </pre>
                      </details>
                    </div>
                  ) : row.content ? (
                    <MarkdownContent markdown={row.content} />
                  ) : (
                    <p className="text-sm text-zinc-500">No content.</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-2 text-[11px] text-zinc-500">
                    <span>{row.attachment_note ?? (row.skipped || row.error ? "" : "Text only")}</span>
                    {onContinueFromResponse && !row.skipped && !row.error && row.content ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onContinueFromResponse(row);
                        }}
                        className="ml-auto rounded-md border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-blue-500/60 hover:bg-blue-950/40 hover:text-blue-100"
                        title="Create a new branch chat seeded with this response."
                      >
                        ↳ Continue from this response
                      </button>
                    ) : null}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </article>

      {/* 6 — Errors & excluded */}
      {(evaluation.excluded_failed_summary.length > 0 ||
        outputs.some((o) => o.error || (o.skipped && !evaluation.scores[o.model_id]))) && (
        <details className="rounded-2xl border border-amber-900/40 bg-amber-950/15 shadow-lg shadow-black/15">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-amber-200 [&::-webkit-details-marker]:hidden">
            <span className="mr-2">⚠</span>
            {evaluation.excluded_failed_summary.length +
              outputs.filter((o) => o.error || (o.skipped && !evaluation.scores[o.model_id]))
                .length}{" "}
            models excluded, skipped, or errored — click for details
          </summary>
          <div className="border-t border-amber-900/25 px-5 py-4 text-sm text-zinc-400">
            <ul className="space-y-3">
              {evaluation.excluded_failed_summary.map((line, i) => (
                <li key={`ex-${i}`} className="font-mono text-xs">
                  {line}
                </li>
              ))}
              {outputs
                .filter((o) => o.error)
                .map((o) => (
                  <li key={`err-${o.model_id}`}>
                    <span className="font-medium text-red-300">{o.label}</span>
                    <span className="text-zinc-500"> · </span>
                    <span>{briefErr(o.error ?? "")}</span>
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-zinc-500">Raw error</summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-600">
                        {o.error}
                      </pre>
                    </details>
                  </li>
                ))}
            </ul>
          </div>
        </details>
      )}

      {rawOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">Raw run payload</h3>
              <button
                type="button"
                onClick={() => setRawOpen(false)}
                className="rounded-lg px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-zinc-400">
              {JSON.stringify({ evaluation, outputs }, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Compare-only runs: no judge JSON — compact cards + markdown + errors at bottom. */
export function CompareRunResultsDashboard({
  outputs,
  models,
  hasImageAttachments,
  onContinueFromResponse,
}: {
  outputs: ModelOutput[];
  models: ModelInfo[];
  hasImageAttachments: boolean;
  onContinueFromResponse?: (output: ModelOutput) => void;
}) {
  const successful = outputs.filter((o) => !o.error && !o.skipped).length;
  const prob = outputs.length - successful;

  return (
    <section className="mb-10 space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm">
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-200 ring-1 ring-emerald-500/25">
          Completed
        </span>
        <span className="text-zinc-400">
          <span className="text-emerald-400">{successful}</span> successful
        </span>
        {prob > 0 ? (
          <span className="text-zinc-400">
            · <span className="text-amber-400">{prob}</span> skipped / failed
          </span>
        ) : null}
      </div>

      <article className="rounded-xl border border-zinc-800/50 bg-zinc-950/25 p-4 shadow-md shadow-black/10 sm:p-5 xl:p-6">
        <h2 className="mb-4 text-lg font-semibold text-zinc-100">Model responses</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {outputs.map((row) => {
            const info = metaFor(models, row.model_id);
            return (
              <details
                key={`${row.model_id}-${row.label}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50"
              >
                <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                      {row.provider}
                    </span>
                    <span className="font-medium text-zinc-100">{row.label}</span>
                    {row.latency_ms != null ? (
                      <span className="font-mono text-xs text-zinc-500">{msToSec(row.latency_ms)}</span>
                    ) : null}
                    <ImageStatusPill row={row} hasImageAttachments={hasImageAttachments} />
                  </div>
                  <div className="mt-2">
                    <CapabilityStrip
                      info={info}
                      score={undefined}
                      latencyMs={row.latency_ms}
                      isWinner={false}
                    />
                  </div>
                  <span className="mt-2 inline-block text-xs font-medium text-blue-400/95">
                    ▸ View full response
                  </span>
                </summary>
                <div className="border-t border-zinc-800 px-4 py-3">
                  {row.skipped ? (
                    <p className="text-sm text-amber-200/90">{briefErr(row.skip_reason ?? "")}</p>
                  ) : row.error ? (
                    <div>
                      <p className="text-sm text-red-200/90">{briefErr(row.error)}</p>
                      <details className="mt-2 text-xs text-zinc-500">
                        <summary className="cursor-pointer">Technical details</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
                          {row.error}
                        </pre>
                      </details>
                    </div>
                  ) : row.content ? (
                    <MarkdownContent markdown={row.content} />
                  ) : (
                    <p className="text-sm text-zinc-500">No content.</p>
                  )}
                  {onContinueFromResponse && !row.skipped && !row.error && row.content ? (
                    <div className="mt-2 flex justify-end border-t border-zinc-800/80 pt-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onContinueFromResponse(row);
                        }}
                        className="rounded-md border border-zinc-700/80 bg-zinc-950/60 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-blue-500/60 hover:bg-blue-950/40 hover:text-blue-100"
                        title="Create a new branch chat seeded with this response."
                      >
                        ↳ Continue from this response
                      </button>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      </article>

      {outputs.some((o) => o.error || o.skipped) ? (
        <details className="rounded-2xl border border-amber-900/40 bg-amber-950/15">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-amber-200 [&::-webkit-details-marker]:hidden">
            Skipped / errors — details
          </summary>
          <ul className="space-y-2 border-t border-amber-900/25 px-5 py-4 text-xs text-zinc-400">
            {outputs
              .filter((o) => o.skipped || o.error)
              .map((o) => (
                <li key={o.model_id}>
                  <span className="font-medium text-zinc-300">{o.label}</span>:{" "}
                  {briefErr(o.skip_reason ?? o.error ?? "")}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
