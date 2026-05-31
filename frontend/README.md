# Kehila Hub Frontend

אפליקציית Vite + React לניהול קהילת שלווה.

## התקנה והרצה

```bash
cp .env.example .env.local
npm install
npm run dev
```

## פקודות שימושיות

```bash
npm run build
npm run lint
npm run preview
```

## Firebase

החיבור ל־Firebase נמצא ב־`src/firebase.js` וקורא ערכים מתוך `VITE_FIREBASE_*`.
אין להעלות קובצי `.env.local` עם סודות למאגר.
