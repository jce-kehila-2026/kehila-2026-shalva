// ErrorBoundary — a root-level safety net.
//
// A React "error boundary" is the only mechanism that can catch an error thrown
// while a component is RENDERING. Without one, such an error unmounts the entire
// React tree and leaves a blank page. This boundary shows a small, generic
// Hebrew fallback (with a reload button) instead, so one broken screen can never
// blank the whole application.
//
// Error boundaries must be CLASS components — there is no Hook equivalent for
// getDerivedStateFromError / componentDidCatch.

import { Component } from 'react';

// Fallback styles (scoped entirely to .error-boundary* class names).
import './ErrorBoundary.css';


class ErrorBoundary extends Component {
  // The only thing we keep in state is a boolean. We deliberately do NOT store
  // the error object, so nothing technical or sensitive can reach the rendered
  // fallback.
  state = { hasError: false };

  // Render phase: React calls this when a descendant throws. We return the next
  // state, which flips to the fallback on the following render.
  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // Commit phase: runs after an error is caught. This is for DEVELOPERS only —
  // we log to the console for debugging and never surface these details to users.
  componentDidCatch(error, errorInfo) {
    console.error('Unhandled UI error caught by ErrorBoundary:', error, errorInfo);
  }

  // The single recovery action: a full page reload. Reloading clears the broken
  // in-memory state, which is safer than resetting the boundary in place — that
  // would re-render the same crashing tree and risk an endless retry loop.
  handleReload = () => {
    window.location.reload();
  };

  render() {
    // Normal path: no error → render the real application untouched.
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Error path: a generic, Hebrew, accessible fallback. role="alert" announces
    // it to assistive tech; aria-labelledby / aria-describedby tie the heading
    // and message to the alert region.
    return (
      <div
        className="error-boundary"
        dir="rtl"
        role="alert"
        aria-labelledby="error-boundary-title"
        aria-describedby="error-boundary-message"
      >
        <div className="error-boundary__card">

          {/* Generic title — no technical detail. */}
          <h1 id="error-boundary-title" className="error-boundary__title">
            אירעה שגיאה בלתי צפויה
          </h1>

          {/* Friendly explanation + what to do next. */}
          <p id="error-boundary-message" className="error-boundary__message">
            משהו השתבש בהצגת המסך. נסו לרענן את הדף.
          </p>

          {/* The only action offered in this batch: reload the page. */}
          <button
            type="button"
            className="error-boundary__reload"
            onClick={this.handleReload}
          >
            רענון הדף
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
