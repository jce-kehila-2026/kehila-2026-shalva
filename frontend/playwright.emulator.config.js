// Playwright config for the EMULATOR-BACKED E2E suite (real UI through the
// Firebase emulators). Run it under `firebase emulators:exec` so Auth (9099),
// Firestore (8080) and Storage (9199) are already up for project demo-kehila:
//
//   firebase emulators:exec --project demo-kehila --config ../firebase.json \
//     "npx playwright test --config=playwright.emulator.config.js"
//
// The dev server is started in `--mode emulator`, so firebase.js points the app
// at the local emulators (never live Firebase). globalSetup seeds Auth +
// Firestore before the specs run.
import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// Generate a RANDOM, ephemeral emulator password once, in memory, and expose it
// only through the environment (never hard-coded, never written to a file, never
// printed). This runs in the main process before the workers are forked, so the
// workers inherit it; global-setup (account creation) and the login helper both
// read it from process.env.E2E_EMULATOR_PASSWORD.
if (!globalThis.process.env.E2E_EMULATOR_PASSWORD) {
  globalThis.process.env.E2E_EMULATOR_PASSWORD = `Pw1-${randomBytes(18).toString('base64url')}`;
}

export default defineConfig({
  testDir: './tests/e2e-emulator',
  testMatch: '**/*.spec.js',

  // Seed Auth + Firestore once, before any spec.
  globalSetup: './tests/e2e-emulator/global-setup.js',

  // Deterministic, serial execution — the specs share one seeded emulator.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // The full guide flow (login -> mark -> save -> reload -> update/delete) is
  // long, so give each test room.
  timeout: 90000,
  expect: { timeout: 15000 },

  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:4174',
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },

  // A fresh dev server in EMULATOR mode on a dedicated localhost port.
  webServer: {
    command: 'npm run dev -- --mode emulator --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120000,
  },

  // Chromium only, two viewports (desktop + mobile).
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
});
