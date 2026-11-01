import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { StoreProvider } from './store/Store';
import { ToastProvider } from './components/ui';
import { registerServiceWorker } from './lib/pwa';
import { applyTheme } from './lib/theme';

applyTheme();
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  </StrictMode>,
);

void registerServiceWorker();
