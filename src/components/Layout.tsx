import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/Store';
import { useRoute } from '../store/router';
import { cx, Button } from './ui';
import { onUpdateAvailable, applyUpdate } from '../lib/pwa';
import { hasUnsavedForm } from '../store/dirty';
import { RemindersBar } from './Reminders';

export const NAV: { href: string; label: string; icon: string; primary?: boolean }[] = [
  { href: '#/', label: 'Dashboard', icon: '🏠', primary: true },
  { href: '#/add', label: 'Add Reading', icon: '➕', primary: true },
  { href: '#/medication', label: 'Medication & Supply', icon: '💊', primary: true },
  { href: '#/weight', label: 'Weight', icon: '⚖️' },
  { href: '#/symptoms', label: 'Symptoms & Lifestyle', icon: '📝' },
  { href: '#/trends', label: 'Trends & Weekly Review', icon: '📈', primary: true },
  { href: '#/history', label: 'History & Reports', icon: '🗂️' },
  { href: '#/appointments', label: 'Appointments', icon: '📅' },
  { href: '#/settings', label: 'Settings & Backups', icon: '⚙️' },
];

function isActive(href: string, path: string) {
  const p = href.replace('#', '');
  return p === '/' ? path === '/' : path.startsWith(p);
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState(false);
  useEffect(() => onUpdateAvailable((w) => setReady(!!w)), []);
  if (!ready) return null;
  return (
    <div className="border-b border-sky-300 bg-sky-50 px-4 py-2 text-sky-950 print:hidden" role="status">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span aria-hidden="true">🔄</span>
        <span className="flex-1">A new version of the app is ready. Your saved records are not affected.</span>
        {warn && <span className="font-medium">You have an unsaved form. Save it first, or update anyway (unsaved typing will be lost).</span>}
        <Button
          variant="primary"
          onClick={() => {
            if (hasUnsavedForm() && !warn) return setWarn(true);
            applyUpdate();
          }}
        >
          {warn ? 'Update anyway' : 'Update now'}
        </Button>
        <Button onClick={() => setReady(false)}>Later</Button>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { mode, setMode } = useStore();
  const { path } = useRoute();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstNav = useRef(true);

  useEffect(() => {
    setMenuOpen(false);
    if (firstNav.current) {
      firstNav.current = false;
      return;
    }
    // Move focus to the new page heading for screen reader and keyboard users.
    requestAnimationFrame(() => {
      const h = document.getElementById('page-title');
      (h ?? mainRef.current)?.focus();
      window.scrollTo(0, 0);
    });
  }, [path]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-3">
        Skip to content
      </a>
      {mode === 'demo' && (
        <div className="border-b-2 border-fuchsia-500 bg-fuchsia-100 px-4 py-2 text-fuchsia-950 print:hidden" role="status">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            <strong>🧪 DEMO MODE — sample data only.</strong>
            <span className="flex-1">These are not your records. Nothing here mixes with your personal data.</span>
            <Button onClick={() => setMode('real')}>Return to my records</Button>
          </div>
        </div>
      )}
      {!online && (
        <div className="border-b border-slate-400 bg-slate-200 px-4 py-2 text-slate-900 print:hidden" role="status">
          <div className="mx-auto max-w-6xl">
            <span aria-hidden="true">📴</span> You are offline. You can keep recording and reviewing — everything is saved on this device.
          </div>
        </div>
      )}
      <UpdateBanner />
      <div className="mx-auto flex max-w-6xl">
        <nav aria-label="Main" className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white p-3 md:flex print:hidden">
          <p className="mb-2 px-2 text-lg font-bold text-teal-800">My BP &amp; Weight Tracker</p>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} aria-current={isActive(n.href, path) ? 'page' : undefined} className={cx('flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 no-underline', isActive(n.href, path) ? 'bg-teal-100 font-semibold text-teal-950' : 'text-slate-800 hover:bg-slate-100')}>
              <span aria-hidden="true">{n.icon}</span> {n.label}
            </a>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
            <span className="font-bold text-teal-800">My BP &amp; Weight Tracker</span>
          </header>
          <RemindersBar />
          <main id="main" ref={mainRef} tabIndex={-1} className="px-3 pb-28 pt-4 outline-none sm:px-6 md:pb-10">
            {children}
          </main>
        </div>
      </div>
      {/* Mobile bottom navigation */}
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-300 bg-white md:hidden print:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.primary).map((n) => (
            <li key={n.href}>
              <a href={n.href} aria-current={isActive(n.href, path) ? 'page' : undefined} className={cx('flex min-h-14 flex-col items-center justify-center px-1 text-xs no-underline', isActive(n.href, path) ? 'font-bold text-teal-900' : 'text-slate-700')}>
                <span aria-hidden="true" className="text-lg">{n.icon}</span>
                {n.label.split(' ')[0]}
              </a>
            </li>
          ))}
          <li>
            <button type="button" aria-expanded={menuOpen} aria-controls="more-menu" onClick={() => setMenuOpen((o) => !o)} className="flex min-h-14 w-full flex-col items-center justify-center text-xs text-slate-700">
              <span aria-hidden="true" className="text-lg">☰</span> More
            </button>
          </li>
        </ul>
        {menuOpen && (
          <ul id="more-menu" className="max-h-[60vh] overflow-y-auto border-t border-slate-200 p-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} aria-current={isActive(n.href, path) ? 'page' : undefined} className="flex min-h-12 items-center gap-2 rounded-lg px-3 no-underline text-slate-800 hover:bg-slate-100">
                  <span aria-hidden="true">{n.icon}</span> {n.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
