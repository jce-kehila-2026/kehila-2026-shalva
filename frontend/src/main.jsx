// Application entry point — mounts <App /> into #root. StrictMode is on to
// surface potential problems in development (it double-invokes some functions).

// React StrictMode wrapper.
import { StrictMode } from 'react';

// React DOM root renderer.
import { createRoot } from 'react-dom/client';

// Root-level error boundary: catches render errors anywhere in the tree so a
// single broken screen shows a fallback instead of blanking the whole page.
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';

// The root component.
import App from './App.jsx';

// Global styles.
import './index.css';


// Mount the app into the #root element from index.html. ErrorBoundary is the
// OUTERMOST wrapper, so it also covers StrictMode + App and every descendant.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </ErrorBoundary>,
);
