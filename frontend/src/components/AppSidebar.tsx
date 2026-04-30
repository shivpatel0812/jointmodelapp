import { useCallback, useEffect, useState } from "react";
import { createChat, listChats } from "../firestore/chats";
import { createProject, listProjects } from "../firestore/projects";
import { getUserSettings, saveUserSettings } from "../firestore/settings";
import type { Chat, Project } from "../firestore/types";

type Props = {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  projectId: string | null;
  chatId: string | null;
  onSelectProject: (project: Project | null) => void;
  onSelectChat: (chat: Chat | null) => void;
  onSignOut: () => void;
  /** Opens global run history panel in parent */
  onOpenHistory: () => void;
  refreshKey?: number;
};

function relativeTime(ts: { toDate(): Date } | null): string {
  if (!ts) return "";
  let d: Date;
  try {
    d = ts.toDate();
  } catch {
    return "";
  }
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AppSidebar({
  uid,
  displayName,
  photoURL,
  projectId,
  chatId,
  onSelectProject,
  onSelectChat,
  onSignOut,
  onOpenHistory,
  refreshKey = 0,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectContext, setNewProjectContext] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState("");

  const reloadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listProjects(uid);
      setProjects(list);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const reloadChats = useCallback(
    async (pid: string | null) => {
      if (!pid) {
        setChats([]);
        return;
      }
      try {
        const list = await listChats(uid, pid);
        setChats(list);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [uid],
  );

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects, refreshKey]);

  useEffect(() => {
    void reloadChats(projectId);
  }, [reloadChats, projectId, refreshKey]);

  const openSettings = useCallback(async () => {
    try {
      const s = await getUserSettings(uid);
      setPrefsDraft(s.preferences ?? "");
    } catch {
      setPrefsDraft("");
    }
    setShowSettings(true);
  }, [uid]);

  const savePrefs = useCallback(async () => {
    await saveUserSettings(uid, { preferences: prefsDraft });
    setShowSettings(false);
  }, [uid, prefsDraft]);

  const handleProjectChange = useCallback(
    (id: string) => {
      if (!id) {
        onSelectProject(null);
        onSelectChat(null);
        return;
      }
      const found = projects.find((p) => p.id === id) ?? null;
      onSelectProject(found);
      onSelectChat(null);
    },
    [projects, onSelectProject, onSelectChat],
  );

  const handleCreateProject = useCallback(async () => {
    const title = newProjectTitle.trim();
    if (!title) return;
    try {
      const id = await createProject(uid, {
        title,
        description: newProjectContext.trim(),
        currentSummary: newProjectContext.trim().slice(0, 2000),
      });
      setNewProjectTitle("");
      setNewProjectContext("");
      setShowProjectModal(false);
      await reloadProjects();
      const list = await listProjects(uid);
      const created = list.find((p) => p.id === id) ?? null;
      onSelectProject(created);
      onSelectChat(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [uid, newProjectTitle, newProjectContext, reloadProjects, onSelectProject, onSelectChat]);

  const handleNewChat = useCallback(async () => {
    if (!projectId) {
      setError("Select a project first.");
      return;
    }
    try {
      const id = await createChat(uid, {
        projectId,
        title: defaultChatTitle(chats.length),
      });
      const refreshed = await listChats(uid, projectId);
      setChats(refreshed);
      const created = refreshed.find((c) => c.id === id) ?? null;
      onSelectChat(created);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [uid, projectId, chats.length, onSelectChat]);

  const initials =
    displayName
      ?.split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  return (
    <>
      <aside className="flex h-screen w-[272px] shrink-0 flex-col border-r border-zinc-800/90 bg-[#0a0a0b]">
        {/* User */}
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-4">
          {photoURL ? (
            <img
              src={photoURL}
              alt=""
              className="h-9 w-9 rounded-full ring-1 ring-zinc-700"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200 ring-1 ring-zinc-700">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">
              {displayName ?? "Signed in"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openSettings()}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Settings"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Project
          </p>
          <div className="relative">
            <select
              value={projectId ?? ""}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={loading}
              className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-900/80 py-2.5 pl-3 pr-9 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
              ▾
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowProjectModal(true)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-transparent py-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900"
          >
            + New project
          </button>

          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={!projectId}
            className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none"
          >
            + New chat
          </button>

          {error ? (
            <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/50 px-2 py-1.5 text-xs text-red-200">
              {error}
            </p>
          ) : null}

          <div className="mt-6">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {selectedProject
                ? `Chats in ${selectedProject.title}`
                : "Chats"}
            </p>
            {!projectId ? (
              <p className="px-1 text-xs leading-relaxed text-zinc-600">
                Pick a project to see and create chats.
              </p>
            ) : chats.length === 0 ? (
              <p className="px-1 text-xs text-zinc-600">No chats yet. Start one above.</p>
            ) : (
              <ul className="space-y-0.5">
                {chats.map((c) => {
                  const active = c.id === chatId;
                  const isBranch = !!c.isBranch;
                  // Indent only when the parent chat is also visible in the
                  // current list — otherwise the indent looks orphaned.
                  const indent =
                    isBranch &&
                    c.parentChatId &&
                    chats.some((p) => p.id === c.parentChatId);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onSelectChat(c)}
                        className={`w-full rounded-lg py-2 text-left transition ${
                          indent ? "pl-5 pr-2" : "px-2"
                        } ${
                          active
                            ? "bg-blue-600/15 ring-1 ring-blue-500/40"
                            : "hover:bg-zinc-900"
                        }`}
                        title={isBranch ? "Branch chat" : undefined}
                      >
                        <p
                          className={`flex items-center gap-1.5 truncate text-sm font-medium ${
                            active ? "text-blue-100" : "text-zinc-200"
                          }`}
                        >
                          {isBranch ? (
                            <span
                              aria-hidden
                              className="shrink-0 text-blue-300/80"
                              title="Branch chat"
                            >
                              ↳
                            </span>
                          ) : null}
                          <span className="truncate">{c.title}</span>
                          {isBranch ? (
                            <span className="ml-auto rounded-md border border-blue-900/40 bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-200/90">
                              branch
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {relativeTime(c.updatedAt)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-800/80 p-3">
          <button
            type="button"
            onClick={onOpenHistory}
            className="w-full rounded-lg py-2 text-left text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-1 w-full rounded-lg py-2 text-left text-sm text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-400"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Create project modal */}
      {showProjectModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-create-project"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#121214] p-6 shadow-2xl shadow-black/50">
            <h2 id="modal-create-project" className="text-lg font-semibold text-white">
              Create New Project
            </h2>
            <label className="mt-5 block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                Project name
              </span>
              <input
                type="text"
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                placeholder="e.g., AI Research Lab"
                autoFocus
                className="w-full rounded-xl border border-blue-500/60 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-zinc-400">
                Context <span className="text-zinc-600">(optional)</span>
              </span>
              <textarea
                value={newProjectContext}
                onChange={(e) => setNewProjectContext(e.target.value)}
                rows={4}
                placeholder="Describe the purpose or goal of this project…"
                className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowProjectModal(false);
                  setNewProjectTitle("");
                  setNewProjectContext("");
                }}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateProject()}
                disabled={!newProjectTitle.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings modal */}
      {showSettings ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#121214] p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-white">Preferences</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Saved to your account. Included as context when models run.
            </p>
            <textarea
              value={prefsDraft}
              onChange={(e) => setPrefsDraft(e.target.value)}
              rows={5}
              placeholder="e.g. Prefer TypeScript, concise answers…"
              className="mt-4 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void savePrefs()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function defaultChatTitle(index: number): string {
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Chat ${index + 1} · ${stamp}`;
}
