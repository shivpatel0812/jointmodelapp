import type { Chat, ChatMessage } from "../firestore/types";

type Props = {
  chat: Chat | null;
  messages: ChatMessage[];
  loading: boolean;
  /** Strip outer card — use inside a collapsible details panel */
  embedded?: boolean;
};

export function ChatThread({ chat, messages, loading, embedded }: Props) {
  if (!chat) return null;

  // Hide the auto-generated branch-context seed; it's already shown in the
  // BranchContextCard above the thread.
  const visibleMessages = messages.filter(
    (m) => !(m.role === "system" && m.mode === "branch_context"),
  );

  const inner = (
    <>
      {!embedded ? (
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{chat.title}</h2>
            {chat.summary ? (
              <p className="mt-0.5 line-clamp-2 max-w-2xl text-xs text-zinc-500">{chat.summary}</p>
            ) : null}
          </div>
          <span className="text-xs text-zinc-500">
            {visibleMessages.length} message{visibleMessages.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : chat.summary ? (
        <p className="mb-3 line-clamp-2 px-1 text-xs text-zinc-500">{chat.summary}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading messages…</p>
      ) : visibleMessages.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No saved messages yet. Send a prompt to start the thread.
        </p>
      ) : (
        <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {visibleMessages.map((m) => (
            <li
              key={m.id}
              className={
                m.role === "user"
                  ? "rounded-lg border border-blue-900/40 bg-blue-950/20 px-3 py-2"
                  : m.role === "system"
                    ? "rounded-lg border border-amber-900/30 bg-amber-950/10 px-3 py-2"
                    : "rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
              }
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                <span
                  className={
                    m.role === "user"
                      ? "font-medium text-blue-300"
                      : m.role === "system"
                        ? "font-medium text-amber-300"
                        : "font-medium text-emerald-300"
                  }
                >
                  {m.role}
                </span>
                {m.modelId ? <span className="font-mono">{m.modelId}</span> : null}
                {m.mode ? <span className="text-zinc-600">· {m.mode}</span> : null}
                {m.latencyMs != null ? (
                  <span className="text-zinc-600">· {Math.round(m.latencyMs)} ms</span>
                ) : null}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-200">
                {m.content}
              </pre>
              {m.role === "user" &&
              Array.isArray(m.attachments) &&
              m.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-blue-900/30 pt-2">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Attachments (metadata)
                  </span>
                  {m.attachments.map((a, i) => (
                    <span
                      key={`${a.fileName}-${i}`}
                      className="rounded-md border border-blue-900/40 bg-blue-950/40 px-2 py-0.5 font-mono text-[11px] text-blue-200/90"
                      title={`${a.mimeType} · ${a.sizeBytes} bytes`}
                    >
                      {a.fileName}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );

  if (embedded) {
    return <div className="p-2">{inner}</div>;
  }

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-xl shadow-black/30">
      {inner}
    </section>
  );
}
