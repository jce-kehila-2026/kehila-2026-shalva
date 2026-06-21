// Shared authentication helper for authenticated E2E tests.
//
// Credentials are read ONLY from process.env and are NEVER returned or logged.
// Tests call credentialsAvailable(role) to skip cleanly when a role's env vars
// are missing. Failures carry only the role name — never an email or password.
import { expect } from '@playwright/test';

// The env-var names per role (values are never read into the report).
const ROLE_ENV = {
  admin: { email: 'E2E_ADMIN_EMAIL', password: 'E2E_ADMIN_PASSWORD' },
  guide: { email: 'E2E_GUIDE_EMAIL', password: 'E2E_GUIDE_PASSWORD' },
};

// Read an env var via globalThis (the lint config treats test files as browser
// code, so the bare `process` global is intentionally avoided). The Node test
// runner provides globalThis.process.
function readEnv(name) {
  return globalThis.process?.env?.[name];
}

// True when both env vars for the given role are present. Exposes no values.
export function credentialsAvailable(role) {
  const keys = ROLE_ENV[role];
  return Boolean(keys && readEnv(keys.email) && readEnv(keys.password));
}

// Sign in through the app's supported login route. The credential values stay
// inside this function; on failure we throw a generic, role-only message.
export async function loginAs(page, role) {
  const keys = ROLE_ENV[role];
  const email = keys && readEnv(keys.email);
  const password = keys && readEnv(keys.password);

  if (!email || !password) {
    throw new Error(`Missing E2E credentials for role: ${role}`);
  }

  await page.goto('/?login=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button.login-submit');

  // The authenticated shell must appear; otherwise fail without any detail.
  try {
    await expect(page.locator('.authenticated-header')).toBeVisible({ timeout: 20000 });
  } catch {
    throw new Error(`Login did not complete for role: ${role}`);
  }
}
