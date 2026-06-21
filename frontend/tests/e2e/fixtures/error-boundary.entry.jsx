// Permanent E2E fixture — NOT part of the application.
//
// It mounts the PRODUCTION ErrorBoundary around a test-only Thrower so the
// regression test can verify the fallback. It is never imported by main.jsx,
// App.jsx, or any production component, and Vite's default build (index.html
// only) never includes it — so it can never reach production.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../../../src/components/ErrorBoundary/ErrorBoundary.jsx';

// Decide throw-vs-recover ONCE at module initialization (not during React
// render), so the render stays pure under StrictMode. The recovery flag is
// written BEFORE the first throw and survives the reload, so the reloaded page
// renders the recovered marker instead of throwing again.
const RECOVERY_KEY = 'eb-fixture-recovered';
const shouldThrow = sessionStorage.getItem(RECOVERY_KEY) !== '1';
sessionStorage.setItem(RECOVERY_KEY, '1');

// Exported so this entry has a component export (keeps react-refresh's lint rule
// satisfied); the export itself is unused — the entry mounts via createRoot below.
export function Thrower() {
  if (shouldThrow) {
    // The sentinel lives ONLY inside the thrown Error (→ console), never in the
    // rendered DOM.
    throw new Error('TEST_INTERNAL_ERROR_SENTINEL');
  }
  return <div data-testid="error-boundary-recovered">recovered</div>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Thrower />
    </ErrorBoundary>
  </StrictMode>,
);
