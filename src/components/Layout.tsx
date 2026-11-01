import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store/Store';
import { useRoute } from '../store/router';
import { cx, Button } from './ui';
import { Icon, Logo, type IconName } from './Icon';
import { onUpdateAvailable, applyUpdate } from '../lib/pwa';
import { hasUnsavedForm } from '../store/dirty';
import { RemindersBar } from './Reminders';
import { formatDateShort, localDateOf } from '../lib/time';

interface NavItem { href: string; label: string; short: string; icon: IconName; primary?: boolean }
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Today', items: [
    { href: '#/', label: 'Dashboard', short: 'Today', icon: 'dashboard', primary: true },
    { href: '#/add', label: 'Add Reading', short: 'Add', icon: 'plus', primary: true },
  ] },
  { title: 'Record', items: [
    { href: '#/medication', label: 'Medication & Supply', short: 'Meds', icon: 'pill', primary: true },
    { href: '#/weight', label: 'Weight', short: 'Weight', icon: 'weight' },
    { href: '#/symptoms', label: 'Symptoms & Lifestyle', short: 'Symptoms', icon: 'clipboard' },
  ] },
  { title: 'Review', items: [
    { href: '#/trends', label: 'Trends & Weekly Review', short: 'Trends', icon: 'chart', primary: true },
    { href: '#/history', label: 'History & Reports', short: 'History', icon: 'file' },
    { href: '#/appointments', label: 'Appointments', short: 'Visits', icon: 'calendar' },
  ] },
  { title: 'Manage', items: [{ href: '#/settings', label: 'Settings & Backups', short: 'Settings', icon: 'sliders' }] },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);

function isActive(href: string, path: string) {
  const p = href.replace('#', '');
  return p === '/' ? path === '/' : path.startsWith(p) || (p === '/history' && path === '/report');
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

function Strip({ tone, icon, children }: { tone: 'sky' | 'slate' | 'demo'; icon: IconName; children: ReactNode }) {
  const t = { sky: 'border-sky-200 bg-sky-50 text-sky-950', slate: 'border-slate-300 bg-slate-800 text-white', demo: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950' }[tone];
  return (
    <div className={cx('border-b px-4 py-2 text-sm print:hidden', t)} role="status">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
        <Icon name={icon} className="h-4 w-4" />
        {children}
      </div>
    </div>
  );
}

function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState(false);
  useEffect(() => onUpdateAvailable((w) => setReady(!!w)), []);
  if (!ready) return null;
  return (
    <Strip tone="sky" icon="refresh">
      <span className="flex-1">A new version of the app is ready. Your saved records are not affected.</span>
      {warn && <span className="font-medium">You have an unsaved form. Save it first, or update anyway (unsaved typing will be lost).</span>}
      <Button variant="primary" className="min-h-9 py-1" onClick={() => { if (hasUnsavedForm() && !warn) return setWarn(true); applyUpdate(); }}>{warn ? 'Update anyway' : 'Update now'}</Button>
      <Button className="min-h-9 py-1" onClick={() => setReady(false)}>Later</Button>
    </Strip>
  );
}

function NavLink({ item, path, compact }: { item: NavItem; path: string; compact?: boolean }) {
  const active = isActive(item.href, path);
  return (
    <a href={item.href} aria-current={active ? 'page' : undefined} className={cx('group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.925rem] no-underline transition-colors', compact && 'min-h-12', active ? 'bg-teal-50 font-semibold text-teal-900' : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>
      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-teal-600" aria-hidden="true" />}
      <Icon name={item.icon} className={cx('h-[18px] w-[18px]', active ? 'text-teal-700' : 'text-slate-400 group-hover:text-slate-600')} />
      {item.label}
    </a>
  );
}

function SidebarFooter({ online }: { online: boolean }) {
  const { data, mode } = useStore();
  const last = data.meta.lastBackupAt;
  return (
    <div className="mt-auto space-y-2 border-t border-slate-200 px-3 pt-3 text-xs text-slate-500">
      <p className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-400')} aria-hidden="true" />{online ? 'Online' : 'Offline — saving on this device'}</p>
      <p className="flex items-center gap-2"><Icon name="database" className="h-3.5 w-3.5" />{mode === 'demo' ? 'Demo data (sample)' : 'Stored on this device only'}</p>
      <p className="flex items-center gap-2"><Icon name="download" className="h-3.5 w-3.5" />{last ? `Backed up ${formatDateShort(localDateOf(last, data.settings.timeZone))}` : 'Not backed up yet'}</p>
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
    <div className="min-h-screen bg-[#f5f7f9] text-slate-900">
      <a href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-3">
        Skip to content
      </a>
      {mode === 'demo' && (
        <Strip tone="demo" icon="flask">
          <strong className="flex-1 sm:flex-none">Demo mode — sample data only.</strong>
          <span className="hidden flex-1 sm:inline">These are not your records and never mix with them.</span>
          <Button className="min-h-9 py-1" onClick={() => setMode('real')}>Return to my records</Button>
        </Strip>
      )}
      {!online && (
        <Strip tone="slate" icon="wifiOff">
          You’re offline. You can keep recording and reviewing — everything is saved on this device.
        </Strip>
      )}
      <UpdateBanner />
      <div className="mx-auto flex max-w-[84rem]">
        <nav aria-label="Main" className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white py-5 md:flex print:hidden">
          <a href="#/" className="mb-6 flex items-center gap-3 px-5 no-underline">
            <Logo />
            <span className="leading-tight">
              <span className="block text-[0.95rem] font-bold tracking-tight text-slate-900">My BP &amp; Weight</span>
              <span className="block text-xs font-medium text-slate-500">Personal health log</span>
            </span>
          </a>
          <div className="flex flex-col gap-5 px-3">
            {NAV_GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-1 px-3 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
                <div className="flex flex-col gap-0.5">{g.items.map((n) => <NavLink key={n.href} item={n} path={path} />)}</div>
              </div>
            ))}
          </div>
          <div className="mt-auto px-2 pt-6"><SidebarFooter online={online} /></div>
        </nav>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur md:hidden print:hidden">
            <Logo className="h-8 w-8" />
            <span className="font-bold tracking-tight text-slate-900">My BP &amp; Weight</span>
          </header>
          <RemindersBar />
          <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-6xl px-4 pb-28 pt-6 outline-none sm:px-8 md:pb-12 md:pt-8">
            {children}
          </main>
        </div>
      </div>
      {/* Mobile bottom navigation */}
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        {menuOpen && (
          <div id="more-menu" className="max-h-[65vh] overflow-y-auto border-b border-slate-200 px-3 py-3">
            {NAV_GROUPS.map((g) => (
              <div key={g.title} className="mb-2">
                <p className="px-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
                {g.items.map((n) => <NavLink key={n.href} item={n} path={path} compact />)}
              </div>
            ))}
          </div>
        )}
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.primary).map((n) => {
            const active = isActive(n.href, path);
            return (
              <li key={n.href}>
                <a href={n.href} aria-current={active ? 'page' : undefined} className={cx('flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[0.7rem] no-underline', active ? 'font-semibold text-teal-800' : 'font-medium text-slate-500')}>
                  {n.href === '#/add' ? (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white shadow"><Icon name="plus" className="h-4 w-4" strokeWidth={2.5} /></span>
                  ) : (
                    <Icon name={n.icon} className="h-5 w-5" />
                  )}
                  {n.short}
                </a>
              </li>
            );
          })}
          <li>
            <button type="button" aria-expanded={menuOpen} aria-controls="more-menu" onClick={() => setMenuOpen((o) => !o)} className={cx('flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium', menuOpen ? 'text-teal-800' : 'text-slate-500')}>
              <Icon name={menuOpen ? 'x' : 'menu'} className="h-5 w-5" /> More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
