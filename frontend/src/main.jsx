// Application entry point — mounts <App /> into #root. StrictMode is on to
// surface potential problems in development (it double-invokes some functions).

// React StrictMode wrapper.
import { StrictMode } from 'react';

// React DOM root renderer.
import { createRoot } from 'react-dom/client';

// The root component.
import App from './App.jsx';

// Global styles.
import './index.css';


// Mount the app into the #root element from index.html.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
