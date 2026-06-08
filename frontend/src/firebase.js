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


// One app instance shared by the whole frontend.
const app = initializeApp(firebaseConfig);

// Authentication service.
export const auth = getAuth(app);

// Firestore database service.
export const db = getFirestore(app);

// Storage service.
export const storage = getStorage(app);
