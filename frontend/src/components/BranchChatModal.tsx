import { useEffect, useMemo, useState } from "react";

type ContextItem = {
  key: string;
  label: string;
  available: boolean;
  /** Optional short hint (e.g. "(3)" sibling count). */
  hint?: string;
};

export type BranchChatModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (title: string) => Promise<void> | void;
  modelLabel: string;
  provider?: string | null;
  responsePreview: string;
  contextItems: ContextItem[];
  /** Defaults to `Discuss <Model> response`. */
  defaultTitle?: string;
  /** Inline error to show under the buttons. */
  error?: string | null;
};

function previewClip(s: string, max = 360): string {
  const t = (s ?? "").trim();
  if (!t) return "(empty response)";
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function BranchChatModal({
  open,
  onClose,
  onConfirm,
  modelLabel,
  provider,
  responsePreview,
  contextItems,
  defaultTitle,
  error,
}: BranchChatModalProps) {
  const fallbackTitle = useMemo(
    () => defaultTitle ?? `Discuss ${modelLabel} response`,
    [defaultTitle, modelLabel],
  );

  const [title, setTitle] = useState(fallbackTitle);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(fallbackTitle);
      setSubmitting(false);
    }
  }, [open, fallbackTitle]);

  if (!open) return null;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm((title.trim() || fallbackTitle).slice(0, 240));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="branch-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#121214] shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <h2
              id="branch-modal-title"
              className="text-base font-semibold text-zinc-100"
            >
              Create branch chat
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              Continue from this response in a new focused chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-2 py-1 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {provider ? (
              <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                {provider}
              </span>
            ) : null}
            <span className="text-sm font-medium text-zinc-100">{modelLabel}</span>
          </div>

          <section>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Selected response preview
            </p>
            <div className="max-h-32 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs leading-relaxed text-zinc-300">
              {previewClip(responsePreview)}
            </div>
          </section>

          <section>
            <label htmlFor="branch-title" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Branch title
            </label>
            <input
              id="branch-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={240}
              autoFocus
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={fallbackTitle}
            />
          </section>

          <section>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Context that will be included
            </p>
            <ul className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-300">
              {contextItems.map((item) => (
                <li
                  key={item.key}
                  className={`flex items-center gap-2 ${
                    item.available ? "text-zinc-200" : "text-zinc-600 line-through"
                  }`}
                >
                  <span aria-hidden className={item.available ? "text-emerald-400" : "text-zinc-700"}>
                    {item.available ? "✓" : "·"}
                  </span>
                  <span>
                    {item.label}
                    {item.hint ? (
                      <span className="ml-1 text-xs text-zinc-500">{item.hint}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              A compact copy of these is stored on the new chat so the branch stays usable
              even if the source run is later deleted.
            </p>
          </section>

          {error ? (
            <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-950/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-md shadow-blue-900/40 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {submitting ? "Creating…" : "Create branch chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
