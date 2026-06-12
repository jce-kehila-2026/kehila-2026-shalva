# Kehila App — Security Checklist Status

Audit of the app against the JCE "Kehila App Security Checklist and Guide"
(Eliedaat Adler). Last verified: 2026-06-12, branch `kehila-fixed-test`.

Roles in THIS app: `admin` / `guide` / `viewer` (stored in `users/{uid}.role`).
They map onto the guide's generic roles as: admin → admin, guide → volunteer
(scoped to one assigned group), viewer → read-only participant-style access.

Legend: ✅ done · ⚠️ done with a documented caveat · ❌ open item

---

## 🔐 Technical Security

- ✅ **No secrets in frontend** — the Firebase client config is read from Vite
  env vars (`frontend/src/firebase.js`); no API keys, tokens or passwords are
  hardcoded anywhere in `src/` (scanned). The only "secrets" the project has
  (LLM keys) belong in the Cloudflare Worker backend, never in React.
- ✅ **Firebase API key not published until rules secure** — stricter than
  required: the key is not in the repo at all. It lives in `frontend/.env.local`,
  which is gitignored (only the empty `frontend/.env.example` is committed).
  Rules are locked down (below), so hosting the built app is safe.
- ✅ **Protected routes** — navigation is state-based (no URL routes), and the
  gate in `frontend/src/App.jsx` decides what renders: signed-out users get
  only the public pages; a signed-in user's `users/{uid}` profile is loaded,
  `disabled` users are signed out immediately, and screens render by `role`.
  There is no admin URL to deep-link into.
- ✅ **No XSS vulnerabilities** — no `dangerouslySetInnerHTML`, `innerHTML`,
  `document.write` or `eval` anywhere in `src/`; all user text is rendered
  through JSX, which escapes by default. Server-side, the public registration
  endpoint validates field names, types and lengths (see `firestore.rules`).
- ✅ **HTTPS only external calls** — there are no direct `fetch()` calls in the
  frontend; all traffic goes through the Firebase SDK (HTTPS only).
- ✅ **Production build only** — `npm run build` (Vite production build);
  there are zero `console.log` calls in `src/` (only `console.error` on
  failure paths).
- ✅ **No source maps** — Vite's default (`sourcemap: false`) is used; `dist/`
  contains no `.map` files.

## 🔐 Firebase Auth

- ✅ **Auth required for all sensitive operations** — every collection except
  the two intentionally-public surfaces (below) requires a signed-in,
  non-disabled user with a profile (`isActiveUser()` in `firestore.rules`).
- ⚠️ **User IDs stored on documents** — adapted to this app's model: ownership
  is per-group, not per-document. A guide's UID maps to their group via
  `guides/{uid}.groupId`, and attendance records carry `groupId` +
  `volunteerId`. Documents guides can write are tied to their identity through
  that mapping rather than an `ownerId` field.
- ✅ **Authorization enforced in Firestore rules** — roles are read
  server-side from `users/{uid}` on every request; UI checks are duplicated,
  never relied on.

## 🔐 Firestore (`firestore.rules`)

- ⚠️ **No public read/write** — two deliberate, documented exceptions:
  `groups` is world-readable (the public showcase page shows them) and
  `registrants` allows public **create only** (the volunteer sign-up form),
  with a strict field whitelist, type checks, length caps and a forced
  "pending" status. Everything else requires an active user; default is deny.
- ✅ **Ownership rules** — `guideAttendanceWrite()` lets a guide create/update
  attendance only for their own group, only with the known attendance fields,
  and only for volunteers that belong to that group; updates also check the
  EXISTING doc's group so records can't be "stolen" across groups.
- ✅ **Role-based rules** — `admin` / `guide` / `viewer` via `hasRole()`;
  user-management writes are admin-only with self-guards (an admin cannot
  change their own role/disabled flag or delete themselves).
- ✅ **Data validation rules** — public registrations are fully validated;
  attendance writes are restricted to a known field set (`keys().hasOnly`).
- ✅ **Emulator tests** — automated: `npm run test:rules` (repo root) starts
  the Firestore + Storage emulators, runs 40 tests in
  `frontend/tests/security-rules.test.js` covering every role (no auth /
  viewer / guide / disabled / admin) against every collection's CRUD rules —
  including the guide group-scoping, the registrant validation, the admin
  self-guards and the storage upload limits — then shuts the emulators down.
  40/40 passing as of 2026-06-12. Requires Java (the emulator runtime).

## 🔐 Storage (`storage.rules`)

- ✅ **No public write** — default deny on all paths.
- ⚠️ **Public read for group cover images only** — by design (the public
  showcase displays them).
- ✅ **Unauthorized access blocked** — uploads are restricted to active admins
  (role checked against Firestore from the storage rules), and limited to
  images (jpeg/png/webp) up to 5MB under `groups/{groupId}/`.

## 🔐 Dependencies

- ✅ **No high/critical vulnerabilities** — `npm audit`: **0 vulnerabilities**
  (2026-06-12). Two highs were fixed: `@grpc/grpc-js` via `npm audit fix`, and
  `xlsx` by installing the patched **0.20.3** build from the official SheetJS
  CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — the npm
  registry copy is stuck on 0.18.5 with no fix). The URL is recorded in
  `frontend/package.json`, so `npm install` fetches the patched build
  automatically. Re-run `npm audit` after every dependency change.

## 🔐 Business Rules (UI + rules must match)

- ✅ **Guides → only their assigned group** — UI locks the group
  (`initialGroup` / `lockGroup` props) AND `firestore.rules` enforces it.
- ✅ **Admins → manage users and roles** — admin-only writes to `users`,
  `guides`, `volunteers`, `groups`, `events`; self-guards included.
- ✅ **Viewers → read-only** — no write rule matches the `viewer` role.
- ✅ **UI hides unauthorized actions / rules enforce the same** — both layers
  exist; the rules are the source of truth.

## Known gaps / next steps

1. **"Don't remove the last admin"** is enforced in the UI only (noted in
   `firestore.rules`); strong enforcement needs a counter/transaction or a
   backend function.
2. **LLM bridge** — if `VITE_KEHILA_LLM_SHARED_SECRET` is ever set, remember
   any `VITE_*` value ships in the public bundle: it is a rate-limiting gate,
   not a secret. Real LLM API keys must stay in the Cloudflare Worker.
3. **Keep the rules tests green** — any change to `firestore.rules`,
   `storage.rules` or the role model must be followed by `npm run test:rules`;
   add a test alongside every new rule.
