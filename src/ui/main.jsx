// main.jsx: the UI entry point. It mounts the React app into the #root div from index.html.

import { StrictMode } from 'react'; // dev-only helper that surfaces bugs early (renders twice on purpose)
import { createRoot } from 'react-dom/client';
import './index.css'; // loads Tailwind and our theme; Vite injects it into the page
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
