import type { Chat, ChatMessage } from "../firestore/types";

type Props = {
  chat: Chat | null;
  messages: ChatMessage[];
  loading: boolean;
};

export function ChatThread({ chat, messages, loading }: Props) {
  if (!chat) return null;

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{chat.title}</h2>
          {chat.summary ? (
            <p className="mt-0.5 line-clamp-2 max-w-2xl text-xs text-slate-500">
              {chat.summary}
            </p>
          ) : null}
        </div>
        <span className="text-xs text-slate-500">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading messages…</p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-slate-500">
          No saved messages yet. Send a prompt to start the thread.
        </p>
      ) : (
        <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {messages.map((m) => (
            <li
              key={m.id}
              className={
                m.role === "user"
                  ? "rounded-lg border border-indigo-900/40 bg-indigo-950/20 px-3 py-2"
                  : m.role === "system"
                    ? "rounded-lg border border-amber-900/30 bg-amber-950/10 px-3 py-2"
                    : "rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              }
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
                <span
                  className={
                    m.role === "user"
                      ? "font-medium text-indigo-300"
                      : m.role === "system"
                        ? "font-medium text-amber-300"
                        : "font-medium text-emerald-300"
                  }
                >
                  {m.role}
                </span>
                {m.modelId ? <span className="font-mono">{m.modelId}</span> : null}
                {m.mode ? <span className="text-slate-600">· {m.mode}</span> : null}
                {m.latencyMs != null ? (
                  <span className="text-slate-600">
                    · {Math.round(m.latencyMs)} ms
                  </span>
                ) : null}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200">
                {m.content}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
