import { useCallback, useEffect, useState } from "react";
import { createChat, listChats } from "../firestore/chats";
import { createProject, listProjects } from "../firestore/projects";
import type { Chat, Project } from "../firestore/types";

type Props = {
  uid: string;
  projectId: string | null;
  chatId: string | null;
  onSelectProject: (project: Project | null) => void;
  onSelectChat: (chat: Chat | null) => void;
  /** Bumped externally to force a refresh after a mutation. */
  refreshKey?: number;
};

export function ProjectChatBar({
  uid,
  projectId,
  chatId,
  onSelectProject,
  onSelectChat,
  refreshKey = 0,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");

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

  const handleChatChange = useCallback(
    (id: string) => {
      if (!id) {
        onSelectChat(null);
        return;
      }
      const found = chats.find((c) => c.id === id) ?? null;
      onSelectChat(found);
    },
    [chats, onSelectChat],
  );

  const handleCreateProject = useCallback(async () => {
    const title = newProjectTitle.trim();
    if (!title) return;
    try {
      const id = await createProject(uid, {
        title,
        description: newProjectDesc.trim(),
      });
      setNewProjectTitle("");
      setNewProjectDesc("");
      setShowNewProject(false);
      await reloadProjects();
      const list = await listProjects(uid);
      const created = list.find((p) => p.id === id) ?? null;
      onSelectProject(created);
      onSelectChat(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [uid, newProjectTitle, newProjectDesc, reloadProjects, onSelectProject, onSelectChat]);

  const handleNewChat = useCallback(async () => {
    try {
      const id = await createChat(uid, {
        projectId,
        title: defaultChatTitle(chats.length),
      });
      const refreshed = await listChats(uid, projectId);
      setChats(refreshed);
      const created = refreshed.find((c) => c.id === id) ?? null;
      onSelectChat(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [uid, projectId, chats.length, onSelectChat]);

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-xl shadow-black/30">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="project-select"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Project
          </label>
          <select
            id="project-select"
            value={projectId ?? ""}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            disabled={loading}
          >
            <option value="">— No project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setShowNewProject((s) => !s)}
          className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-600"
        >
          {showNewProject ? "Cancel" : "+ New project"}
        </button>

        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="chat-select"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Chat
          </label>
          <select
            id="chat-select"
            value={chatId ?? ""}
            onChange={(e) => handleChatChange(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">— New thread (unsaved) —</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void handleNewChat()}
          className="rounded-lg border border-indigo-500/60 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/20"
        >
          + New chat
        </button>
      </div>

      {showNewProject ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <input
            type="text"
            value={newProjectTitle}
            onChange={(e) => setNewProjectTitle(e.target.value)}
            placeholder="Project title (e.g. 'Joint Model App')"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <textarea
            value={newProjectDesc}
            onChange={(e) => setNewProjectDesc(e.target.value)}
            rows={2}
            placeholder="Short description / what you're building"
            className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={!newProjectTitle.trim()}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
            >
              Create project
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      ) : null}
    </section>
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
