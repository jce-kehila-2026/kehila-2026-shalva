# Kehila Hub — Shalva 2026

מערכת React + Firebase לניהול קהילה: הרשמה להתנדבות, כניסת משתמשים, ניהול קבוצות, מתנדבים, מדריכים, אירועים ודוחות.

## מה יש בפרויקט

- `frontend/` — אפליקציית Vite/React הראשית.
- `docs/` — תבניות ותיעוד לפרויקט.
- `backend/` — שמור לשכבת backend עתידית.

## הרצה מקומית

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

לאחר ההרצה פותחים את כתובת Vite שמופיעה בטרמינל, בדרך כלל `http://localhost:5173`.

אפשר גם להריץ מהשורש:

```bash
npm run dev
npm run build
npm run lint
```

## משתני סביבה נדרשים

הקובץ `frontend/.env.local` צריך להכיל את ערכי Firebase:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## מבנה מסכים אחרי האיחוד

- דף ציבורי: קבוצות פעילות, כניסה והרשמה להתנדבות.
- Admin Dashboard: קבוצות, מתנדבים, מדריכים, אירועים ודוחות.
- Guide Dashboard: הקבוצה שלי, סימון נוכחות ורשימת מתנדבים.
- Viewer/User: רשימת משתמשים, אירועים ודוחות לפי הרשאות Firebase.

## בדיקות שבוצעו

```bash
npm --prefix frontend run build
npm --prefix frontend run lint
```

שתי הפקודות עוברות בהצלחה. בבנייה קיימת אזהרת Vite על גודל bundle בגלל Firebase והמסכים הרבים, אבל זו אינה שגיאת build.
