// Runtime-error collection helper for E2E tests.
//
// Attach BEFORE navigation. Errors are recorded by TYPE only — the message text
// is never stored, so nothing sensitive can reach a report. ReferenceErrors are
// tracked separately, and console.error firing is noted in redacted form.
import { expect } from '@playwright/test';

export function collectRuntimeErrors(page) {
  const pageErrors = [];
  const referenceErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => {
    const name = error?.name || 'Error';
    pageErrors.push(name);
    if (name === 'ReferenceError') {
      referenceErrors.push(name);
    }
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      // Redacted — the message text is never captured.
      consoleErrors.push('console.error');
    }
  });

  return { pageErrors, referenceErrors, consoleErrors };
}

// Assert a normal, healthy authenticated flow: no uncaught errors, no
// ReferenceError, no ErrorBoundary fallback, and a populated #root.
export async function assertNoRuntimeErrors(page, collected) {
  expect(collected.pageErrors, 'no uncaught page errors').toEqual([]);
  expect(collected.referenceErrors, 'no ReferenceError').toEqual([]);
  await expect(page.locator('.error-boundary')).toHaveCount(0);
  await expect(page.locator('#root').locator(':scope > *').first()).toBeVisible();
}
