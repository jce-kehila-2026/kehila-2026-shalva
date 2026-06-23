// Login/logout helpers for the emulator E2E suite. They drive the REAL login UI
// (the /?login=1 route), signing in against the Auth emulator with the seeded
// test accounts. The password is read ONLY from the environment — never stored
// in source — so nothing here is a live secret and no value is ever logged.
import { expect } from '@playwright/test';

import { TEST_USERS } from '../fixtures/seed-data.js';

function emulatorPassword() {
  const password = globalThis.process?.env?.E2E_EMULATOR_PASSWORD;
  if (!password) {
    throw new Error('Missing E2E_EMULATOR_PASSWORD environment variable.');
  }
  return password;
}

// Sign in through the app's login screen as one of the seeded roles
// ('admin' | 'guideA' | 'guideB' | 'noRole').
export async function loginAs(page, roleKey) {
  const user = TEST_USERS[roleKey];
  if (!user) {
    throw new Error(`Unknown E2E role: ${roleKey}`);
  }

  await page.goto('/?login=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', user.email);
  await page.fill('#login-password', emulatorPassword());
  await page.click('button.login-submit');

  // The signed-in shell must appear.
  await expect(page.locator('.authenticated-header')).toBeVisible({ timeout: 20000 });
}

// Sign out via the header control ("התנתקות"), returning to the public surface.
export async function logout(page) {
  await page.locator('button.auth-btn-danger').click();
  // The authenticated shell is gone once signed out.
  await expect(page.locator('.authenticated-header')).toHaveCount(0, { timeout: 20000 });
}
