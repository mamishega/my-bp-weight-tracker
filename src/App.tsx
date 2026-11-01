import { lazy, Suspense } from 'react';
import { useStore } from './store/Store';
import { useRoute } from './store/router';
import { Layout } from './components/Layout';
import { LockScreen } from './components/LockScreen';
import { Notice } from './components/ui';
import { ShareSync } from './components/ShareSync';
import { PushSync } from './components/PushSync';
import { Dashboard } from './pages/Dashboard';
import { AddReading } from './pages/AddReading';
import { MedicationPage } from './pages/Medication';
const WeightPage = lazy(() => import('./pages/Weight').then((m) => ({ default: m.WeightPage })));
const SymptomsLifestylePage = lazy(() => import('./pages/SymptomsLifestyle').then((m) => ({ default: m.SymptomsLifestylePage })));
const TrendsPage = lazy(() => import('./pages/Trends').then((m) => ({ default: m.TrendsPage })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const ReportPage = lazy(() => import('./pages/Report').then((m) => ({ default: m.ReportPage })));
const AppointmentsPage = lazy(() => import('./pages/Appointments').then((m) => ({ default: m.AppointmentsPage })));
const MeasurementWeekPage = lazy(() => import('./pages/MeasurementWeek').then((m) => ({ default: m.MeasurementWeekPage })));
const SharePage = lazy(() => import('./pages/Share').then((m) => ({ default: m.SharePage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

function Page({ path }: { path: string }) {
  switch (path) {
    case '/': return <Dashboard />;
    case '/add': return <AddReading />;
    case '/medication': return <MedicationPage />;
    case '/weight': return <WeightPage />;
    case '/symptoms': return <SymptomsLifestylePage />;
    case '/trends': return <TrendsPage />;
    case '/history': return <HistoryPage />;
    case '/report': return <ReportPage />;
    case '/appointments': return <AppointmentsPage />;
    case '/settings': return <SettingsPage />;
    case '/share': return <SharePage />;
    case '/week': return <MeasurementWeekPage />;
    default: return <Notice tone="warn" title="Page not found"><a href="#/">Go to the dashboard</a></Notice>;
  }
}

export function App() {
  const { loading, error, mode, locked } = useStore();
  const { path } = useRoute();
  if (locked) return <LockScreen />;
  return (
    <Layout>
      <ShareSync />
      <PushSync />
      {error && <Notice tone="danger" role="alert" title="Storage problem">{error}</Notice>}
      {loading ? <p role="status" className="p-6 text-center text-slate-600">Loading your {mode === 'demo' ? 'demo ' : ''}records…</p> : (
        <Suspense fallback={<p role="status" className="p-6 text-center text-slate-500">Loading…</p>}>
          <Page path={path} />
        </Suspense>
      )}
    </Layout>
  );
}
