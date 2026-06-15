// Firebase initialisation — creates the shared app and exports the services
// (auth, Firestore, storage). Credentials come from Vite env vars (.env.local).

// Firebase SDK entry points.
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";


// Config read from the local environment variables (no secrets committed).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};


// During development, fail loudly and clearly if any config value is missing
// (a forgotten or incomplete .env.local). Without this, the app would start and
// only later crash with Firebase's cryptic "auth/invalid-api-key" error.
if (import.meta.env.DEV) {
  // Collect the names of every config field that came back empty.
  const missingKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    console.warn(
      'Firebase config is missing: ' + missingKeys.join(', ') +
      '. Check that frontend/.env.local exists and has all the VITE_FIREBASE_* values.'
    );
  }
}


// One app instance shared by the whole frontend.
const app = initializeApp(firebaseConfig);

// Authentication service.
export const auth = getAuth(app);

// Send Firebase auth emails (e.g. the password-reset email) in Hebrew.
// The reset link itself stays as Firebase's URL.
auth.languageCode = 'he';

// Firestore database service.
export const db = getFirestore(app);

// Storage service.
export const storage = getStorage(app);
