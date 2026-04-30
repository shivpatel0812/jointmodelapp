import { initializeApp, type FirebaseOptions } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
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

function requireEnv(name: keyof ImportMetaEnv): string {
  const v = import.meta.env[name];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  throw new Error(
    `Missing ${String(name)}. Copy frontend/.env.example → frontend/.env.local and add your Firebase web app values (Console → Project settings → Your apps).`,
  );
}

function optionalEnv(name: keyof ImportMetaEnv): string | undefined {
  const v = import.meta.env[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

const firebaseConfig: FirebaseOptions = {
  apiKey: requireEnv("VITE_FIREBASE_API_KEY"),
  authDomain: requireEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: requireEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: requireEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: requireEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: requireEnv("VITE_FIREBASE_APP_ID"),
};
const measurementId = optionalEnv("VITE_FIREBASE_MEASUREMENT_ID");
if (measurementId) {
  firebaseConfig.measurementId = measurementId;
}

const app = initializeApp(firebaseConfig);

/** Analytics only when `measurementId` is set and the browser supports it. */
export const analyticsPromise: Promise<Analytics | null> =
  measurementId != null
    ? isSupported().then((ok) => (ok ? getAnalytics(app) : null))
    : Promise.resolve(null);

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
