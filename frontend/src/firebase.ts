import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/** Prefer `VITE_FIREBASE_*` from `.env.local` / Vercel; fall back to the bundled project defaults. */
function env(name: keyof ImportMetaEnv, fallback: string): string {
  const v = import.meta.env[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

const firebaseConfig = {
  apiKey: env("VITE_FIREBASE_API_KEY", "AIzaSyDWhWRlRlsYxi6rl4_0s33_XVJFmDCKDmw"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN", "jointmodelapp.firebaseapp.com"),
  projectId: env("VITE_FIREBASE_PROJECT_ID", "jointmodelapp"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET", "jointmodelapp.firebasestorage.app"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID", "918256895528"),
  appId: env("VITE_FIREBASE_APP_ID", "1:918256895528:web:4a8432036dbeea69eed71d"),
  measurementId: env("VITE_FIREBASE_MEASUREMENT_ID", "G-NXEK7JTCYT"),
};

const app = initializeApp(firebaseConfig);

/**
 * Use initializeAuth so we can pin persistence + the redirect resolver. Without
 * an explicit popupRedirectResolver, signInWithRedirect / getRedirectResult
 * throw `auth/argument-error`.
 */
let auth: ReturnType<typeof getAuth>;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
} catch {
  // initializeAuth can only be called once per app; fall back if it was already initialized.
  auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence).catch(() => {
    /* leave default */
  });
}

/**
 * `getRedirectResult` must run exactly once per full page load. React 18 Strict Mode
 * runs mount effects twice in dev; a second call can leave the user unsigned in.
 */
let redirectResultPromise: ReturnType<typeof getRedirectResult> | null = null;

export function finalizeRedirectSignIn() {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth, browserPopupRedirectResolver);
  }
  return redirectResultPromise;
}

export { auth };
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
