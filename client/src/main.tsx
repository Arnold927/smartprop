import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary, reloadOnStaleBuild } from "./components/app-error-boundary";
import "./index.css";
// Initialise i18n before React renders — must be imported for side-effects
import "./i18n";

// After a "fresh" reload (see reloadFresh) remove the cache-busting parameter again so links stay clean.
try {
  const u = new URL(window.location.href);
  if (u.searchParams.has("_v")) {
    u.searchParams.delete("_v");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  }
} catch { /* ignore */ }

// Vite fires this when a lazy page's files can't be loaded (typically: this tab, or a cached page, is from an
// older build). Reload once to a fresh copy instead of showing an error.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnStaleBuild()) event.preventDefault();
});

// Register service worker for PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);