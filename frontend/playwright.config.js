// Playwright E2E configuration.
//
// Permanent, UNAUTHENTICATED browser tests. They run against a dedicated Vite
// DEV server (never a reused one), in Chromium only, at two viewports. The dev
// server is used (not `vite preview`) so the nested ErrorBoundary fixture HTML
// under tests/ is served directly — it is intentionally excluded from the
// production build. No credentials and no artifacts in this first batch.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Only the E2E specs in this folder.
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',

  // Deterministic execution for this first cut.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // A reasonable per-test timeout plus a web-first assertion timeout.
  timeout: 30000,
  expect: { timeout: 10000 },

  // Concise console output; no HTML report, trace, screenshots or videos yet.
  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },

  // Start a fresh Vite dev server on a dedicated port (not 5173, never reused).
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120000,
  },

  // Chromium only, two viewports.
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
