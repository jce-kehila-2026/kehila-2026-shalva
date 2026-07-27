// Firebase initialisation — creates the shared app and exports the services
// (auth, Firestore, storage).
//
// Normal dev + production read the config from Vite env vars (.env.local) and
// talk to LIVE Firebase. The dedicated "emulator" Vite mode (DEV only) instead
// uses a non-secret demo project and points every service at the local Firebase
// emulators, so emulator-backed E2E tests never touch live Firebase.

// Firebase SDK entry points (getApp/getApps keep init idempotent under HMR).
import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";


// Emulator mode is ON only when BOTH are true: the dev server is running AND the
// dedicated "emulator" Vite mode is active (npm run dev -- --mode emulator).
// A production build always has import.meta.env.DEV === false — even for
// `vite build --mode emulator` — so this is statically false there and the
// emulator config + connection block below are dropped from the bundle. It can
// NOT be enabled via URL/query, hostname, localStorage, sessionStorage, or any
// user-controlled runtime value.
const useEmulators =
  import.meta.env.DEV === true && import.meta.env.MODE === 'emulator';


// In emulator mode use a NON-secret demo project (the same projectId the Firebase
// CLI and the rules tests use — demo-kehila — so every layer agrees). Otherwise
// use the live config from the local environment variables. Because useEmulators
// is a compile-time constant, the unused branch is eliminated from the build, so
// the demo values never appear in a production bundle.
const firebaseConfig = useEmulators
  ? {
      apiKey: 'fake-api-key',
      authDomain: 'demo-kehila.firebaseapp.com',
      projectId: 'demo-kehila',
      storageBucket: 'demo-kehila.appspot.com',
      messagingSenderId: 'demo-sender-id',
      appId: 'demo-app-id',
    }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };


// Fail loudly or log a warning if any live config value is missing (e.g. forgotten GitHub Secrets or .env).
if (!useEmulators) {
  // Collect the names of every config field that came back empty.
  const missingKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    console.warn(
      'Firebase config is missing: ' + missingKeys.join(', ') +
      '. Check that environment variables / GitHub Secrets (VITE_FIREBASE_*) are set during build.'
    );
  }
}


// One app instance shared by the whole frontend. Reuse an existing app instead
// of calling initializeApp twice (which throws) if HMR re-evaluates this module.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Authentication service.
export const auth = getAuth(app);

// Send Firebase auth emails (e.g. the password-reset email) in Hebrew.
// The reset link itself stays as Firebase's URL.
auth.languageCode = 'he';

// Firestore database service.
export const db = getFirestore(app);

// Storage service.
export const storage = getStorage(app);


// In emulator mode, point every service at the local emulators BEFORE any
// consuming component runs (this executes at module load). HMR can re-evaluate
// this module, so a module-load guard prevents reconnecting an already-connected
// service (which would throw). This whole block is dev+emulator-only and is
// removed from production bundles.
if (useEmulators) {
  // Guard lives on globalThis so it survives an HMR re-evaluation of this module.
  const EMULATORS_CONNECTED = '__kehilaEmulatorsConnected';

  if (!globalThis[EMULATORS_CONNECTED]) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    globalThis[EMULATORS_CONNECTED] = true;
  }
}


// Create a NAMED secondary Firebase app + its Auth instance, using the SAME
// config the default app selected (demo in emulator mode, live otherwise). In
// emulator mode the secondary Auth is connected to the local Auth emulator
// BEFORE it is returned, so a secondary-app sign-in / account-create can never
// reach live Firebase (the same fail-closed guarantee as the default services).
// Used by GuideManagement so creating a guide doesn't sign the current admin
// out; the caller owns the lifecycle (deleteApp when done).
export function createSecondaryAuth(appName) {
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);

  if (useEmulators) {
    connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }

  return { secondaryApp, secondaryAuth };
}
