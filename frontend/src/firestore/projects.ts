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
} from "firebase/firestore";
import { db } from "../firebase";
import type { Project } from "./types";

// TODO(auth): replace `uid` args with server-enforced auth (e.g. Firestore
// security rules + a callable function). For now uid is passed from the client.

const STR_LIMIT = 4_000;
const SUMMARY_LIMIT = 6_000;
const ITEM_LIMIT = 240;
const ITEMS_MAX = 32;

function clamp(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function clampList(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, ITEMS_MAX)
    .map((x) => clamp(String(x ?? "").trim(), ITEM_LIMIT))
    .filter((s) => s.length > 0);
}

export async function listProjects(uid: string): Promise<Project[]> {
  const q = query(
    collection(db, "users", uid, "projects"),
    orderBy("updatedAt", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map(toProject);
}

export async function getProject(
  uid: string,
  projectId: string,
): Promise<Project | null> {
  const ref = doc(db, "users", uid, "projects", projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return toProject(snap);
}

export async function createProject(
  uid: string,
  data: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> & {
    title: string;
  },
): Promise<string> {
  const now = Timestamp.now();
  const ref = await addDoc(collection(db, "users", uid, "projects"), {
    title: clamp(data.title.trim(), 240),
    description: clamp(data.description?.trim() ?? "", STR_LIMIT),
    techStack: clampList(data.techStack),
    currentSummary: clamp(data.currentSummary?.trim() ?? "", SUMMARY_LIMIT),
    features: clampList(data.features),
    decisions: clampList(data.decisions),
    openQuestions: clampList(data.openQuestions),
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateProject(
  uid: string,
  projectId: string,
  patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>,
): Promise<void> {
  const update: Record<string, FieldValue | string | string[]> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.title !== undefined) update.title = clamp(patch.title.trim(), 240);
  if (patch.description !== undefined)
    update.description = clamp(patch.description.trim(), STR_LIMIT);
  if (patch.techStack !== undefined) update.techStack = clampList(patch.techStack);
  if (patch.currentSummary !== undefined)
    update.currentSummary = clamp(patch.currentSummary.trim(), SUMMARY_LIMIT);
  if (patch.features !== undefined) update.features = clampList(patch.features);
  if (patch.decisions !== undefined) update.decisions = clampList(patch.decisions);
  if (patch.openQuestions !== undefined)
    update.openQuestions = clampList(patch.openQuestions);
  await updateDoc(doc(db, "users", uid, "projects", projectId), update);
}

function toProject(snap: {
  id: string;
  data(): Record<string, unknown>;
}): Project {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    title: String(d.title ?? "Untitled project"),
    description: String(d.description ?? ""),
    techStack: Array.isArray(d.techStack) ? (d.techStack as string[]) : [],
    currentSummary: String(d.currentSummary ?? ""),
    features: Array.isArray(d.features) ? (d.features as string[]) : [],
    decisions: Array.isArray(d.decisions) ? (d.decisions as string[]) : [],
    openQuestions: Array.isArray(d.openQuestions) ? (d.openQuestions as string[]) : [],
    createdAt: (d.createdAt as Timestamp | undefined) ?? null,
    updatedAt: (d.updatedAt as Timestamp | undefined) ?? null,
  };
}
