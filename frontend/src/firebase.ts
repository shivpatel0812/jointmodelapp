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
