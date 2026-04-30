import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDWhWRlRlsYxi6rl4_0s33_XVJFmDCKDmw",
  authDomain: "jointmodelapp.firebaseapp.com",
  projectId: "jointmodelapp",
  storageBucket: "jointmodelapp.firebasestorage.app",
  messagingSenderId: "918256895528",
  appId: "1:918256895528:web:4a8432036dbeea69eed71d",
  measurementId: "G-NXEK7JTCYT",
};

const app = initializeApp(firebaseConfig);

/** Prefer IndexedDB with localStorage fallback (helps when IDB is blocked). */
let auth: ReturnType<typeof getAuth>;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  });
} catch {
  auth = getAuth(app);
}

/**
 * `getRedirectResult` must run exactly once per full page load. React 18 Strict Mode
 * runs mount effects twice in dev; a second call can leave the user unsigned in.
 */
let redirectResultPromise: ReturnType<typeof getRedirectResult> | null = null;

export function finalizeRedirectSignIn() {
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth);
  }
  return redirectResultPromise;
}

export { auth };
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
