import {
  type FieldValue,
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Chat } from "./types";

// TODO(auth): rules should restrict reads/writes to the chat's owning user.

export async function listChats(
  uid: string,
  projectId: string | null = null,
): Promise<Chat[]> {
  const base = collection(db, "users", uid, "chats");
  const q = projectId
    ? query(base, where("projectId", "==", projectId), orderBy("updatedAt", "desc"))
    : query(base, orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(toChat);
}

export async function getChat(uid: string, chatId: string): Promise<Chat | null> {
  const ref = doc(db, "users", uid, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toChat(snap);
}

export async function createChat(
  uid: string,
  data: { projectId: string | null; title?: string },
): Promise<string> {
  const now = Timestamp.now();
  const ref = await addDoc(collection(db, "users", uid, "chats"), {
    projectId: data.projectId,
    title: (data.title ?? "New chat").trim().slice(0, 240) || "New chat",
    summary: "",
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateChat(
  uid: string,
  chatId: string,
  patch: Partial<Pick<Chat, "title" | "summary" | "projectId">>,
): Promise<void> {
  const update: Record<string, FieldValue | string | null> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.title !== undefined) update.title = patch.title.trim().slice(0, 240);
  if (patch.summary !== undefined) update.summary = patch.summary.slice(0, 8_000);
  if (patch.projectId !== undefined) update.projectId = patch.projectId;
  await updateDoc(doc(db, "users", uid, "chats", chatId), update);
}

/**
 * Touch the chat's `updatedAt` so it re-sorts to the top of the list.
 * Use after sending a turn or saving a run.
 */
export async function touchChat(uid: string, chatId: string): Promise<void> {
  await updateDoc(doc(db, "users", uid, "chats", chatId), {
    updatedAt: serverTimestamp(),
  });
}

function toChat(snap: { id: string; data(): Record<string, unknown> }): Chat {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    projectId: (d.projectId as string | null | undefined) ?? null,
    title: String(d.title ?? "New chat"),
    summary: String(d.summary ?? ""),
    createdAt: (d.createdAt as Timestamp | undefined) ?? null,
    updatedAt: (d.updatedAt as Timestamp | undefined) ?? null,
  };
}
