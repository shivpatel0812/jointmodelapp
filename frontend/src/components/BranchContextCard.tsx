import type { BranchSource } from "../firestore/types";
import { MarkdownContent } from "./MarkdownContent";

type Props = {
  source: BranchSource;
  /** Optional handler to navigate the user back to the parent chat. */
  onOpenParent?: () => void;
};

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-lg border border-zinc-800/70 bg-zinc-950/30"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 transition hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block text-zinc-600 group-open:rotate-90 transition-transform">
          ▸
        </span>
        {title}
      </summary>
      <div className="border-t border-zinc-800/70 px-3 py-2.5 text-sm text-zinc-300">
        {children}
      </div>
    </details>
  );
}

export function BranchContextCard({ source, onOpenParent }: Props) {
  const siblings = source.siblingResponses ?? [];

  return (
    <section
      aria-label="Branch context"
      className="mb-4 rounded-xl border border-blue-900/40 bg-blue-950/15 shadow-md shadow-black/15"
    >
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span aria-hidden className="text-base text-blue-300/80">↳</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-blue-100">
            Continuing from{" "}
            <span className="font-semibold">{source.sourceModelLabel}</span>{" "}
            response.
          </p>
          <p className="text-[11px] text-zinc-500">
            Other model responses{siblings.length > 0 ? ` (${siblings.length})` : ""}
            {source.judgeSummary ? ", judge summary" : ""}
            {source.finalSynthesis ? ", final synthesis" : ""}
            {source.pipelineTrace ? ", pipeline trace" : ""}
            {" "}included as context.
          </p>
        </div>
        {source.sourceProvider ? (
          <span className="rounded-md border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 text-[11px] text-zinc-400">
            {source.sourceProvider}
          </span>
        ) : null}
        {onOpenParent ? (
          <button
            type="button"
            onClick={onOpenParent}
            className="rounded-md border border-zinc-700 bg-zinc-950/70 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-zinc-900"
          >
            Open source chat
          </button>
        ) : null}
      </header>

      <div className="space-y-2 border-t border-blue-900/30 px-3 py-3">
        {source.originalPrompt ? (
          <Section title="Original prompt">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
              {source.originalPrompt}
            </pre>
          </Section>
        ) : null}

        <Section title={`Source response · ${source.sourceModelLabel}`} defaultOpen>
          <MarkdownContent markdown={source.selectedResponse || "(empty)"} />
        </Section>

        {siblings.length > 0 ? (
          <Section title={`Sibling responses (${siblings.length})`}>
            <ul className="space-y-3">
              {siblings.map((s, i) => (
                <li
                  key={`${s.modelId}-${i}`}
                  className="rounded-md border border-zinc-800/70 bg-zinc-950/40 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {s.provider ? (
                      <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                        {s.provider}
                      </span>
                    ) : null}
                    <span className="text-sm font-medium text-zinc-200">{s.modelLabel}</span>
                  </div>
                  <MarkdownContent markdown={s.response || "(empty)"} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {source.judgeSummary ? (
          <Section title="Judge summary">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
              {source.judgeSummary}
            </pre>
          </Section>
        ) : null}

        {source.finalSynthesis ? (
          <Section title="Final synthesis">
            <MarkdownContent markdown={source.finalSynthesis} />
          </Section>
        ) : null}

        {source.pipelineTrace ? (
          <Section title="Pipeline trace">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
              Status: <span className="text-zinc-300">{source.pipelineTrace.status}</span>
            </p>
            <ol className="mb-3 space-y-1.5">
              {source.pipelineTrace.steps.map((step, i) => (
                <li
                  key={`${step.step}-${i}`}
                  className="rounded-md border border-zinc-800/70 bg-zinc-950/40 p-2 text-sm text-zinc-300"
                >
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">
                    {step.step}
                    {step.modelLabel ? (
                      <span className="ml-1 text-zinc-400 normal-case">
                        · {step.modelLabel}
                      </span>
                    ) : null}
                  </p>
                  {step.summary ? (
                    <p className="mt-1 text-xs text-zinc-400">{step.summary}</p>
                  ) : null}
                </li>
              ))}
            </ol>
            {source.pipelineTrace.finalAnswer ? (
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
                  Final answer
                </p>
                <MarkdownContent markdown={source.pipelineTrace.finalAnswer} />
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </section>
  );
}
