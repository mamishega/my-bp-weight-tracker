import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { StoreProvider } from './store/Store';
import { ToastProvider } from './components/ui';
import { registerServiceWorker } from './lib/pwa';
import { applyTheme } from './lib/theme';
import { isSharedHash, parseShareHash } from './lib/share';

const SharedView = lazy(() => import('./pages/SharedView').then((m) => ({ default: m.SharedView })));

applyTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

// A doctor opening a live share link gets only the read-only viewer: the
// patient app (and its storage) is never started.
const startedShared = isSharedHash(location.hash);
const shared = parseShareHash(location.hash);
window.addEventListener('hashchange', () => {
  if (isSharedHash(location.hash) !== startedShared) location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {startedShared ? (
      shared ? (
        <Suspense fallback={<p role="status" className="p-10 text-center">Loading shared records…</p>}>
          <SharedView link={shared} />
        </Suspense>
      ) : (
        <main className="mx-auto max-w-xl p-6"><h1 className="mb-2 text-xl font-bold">Shared records</h1><p role="alert">This link is incomplete or damaged. Check that the whole link was copied, including everything after the # sign.</p></main>
      )
    ) : (
      <StoreProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </StoreProvider>
    )}
  </StrictMode>,
);

void registerServiceWorker();
