import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { UserSettings } from "./types";

// TODO(auth): security rules should restrict /users/{uid}/settings/profile
// reads/writes to request.auth.uid == uid.

const DOC_ID = "profile";

export async function getUserSettings(uid: string): Promise<UserSettings> {
  const ref = doc(db, "users", uid, "settings", DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return {};
  const d = snap.data();
  return {
    preferences: typeof d.preferences === "string" ? d.preferences : "",
    defaultProjectId:
      typeof d.defaultProjectId === "string" ? d.defaultProjectId : null,
    defaultMode:
      d.defaultMode === "compare" ||
      d.defaultMode === "synthesize" ||
      d.defaultMode === "pipeline"
        ? d.defaultMode
        : undefined,
  };
}

export async function saveUserSettings(
  uid: string,
  patch: Partial<UserSettings>,
): Promise<void> {
  const ref = doc(db, "users", uid, "settings", DOC_ID);
  await setDoc(
    ref,
    {
      ...(patch.preferences !== undefined
        ? { preferences: patch.preferences.slice(0, 4_000) }
        : {}),
      ...(patch.defaultProjectId !== undefined
        ? { defaultProjectId: patch.defaultProjectId }
        : {}),
      ...(patch.defaultMode !== undefined
        ? { defaultMode: patch.defaultMode }
        : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
