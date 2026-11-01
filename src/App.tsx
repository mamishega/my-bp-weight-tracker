import { useStore } from './store/Store';
import { useRoute } from './store/router';
import { Layout } from './components/Layout';
import { Notice } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { AddReading } from './pages/AddReading';
import { MedicationPage } from './pages/Medication';
import { WeightPage } from './pages/Weight';
import { SymptomsLifestylePage } from './pages/SymptomsLifestyle';
import { TrendsPage } from './pages/Trends';
import { HistoryPage } from './pages/History';
import { ReportPage } from './pages/Report';
import { AppointmentsPage } from './pages/Appointments';
import { SettingsPage } from './pages/Settings';

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
    default: return <Notice tone="warn" title="Page not found"><a href="#/">Go to the dashboard</a></Notice>;
  }
}

export function App() {
  const { loading, error, mode } = useStore();
  const { path } = useRoute();
  return (
    <Layout>
      {error && <Notice tone="danger" role="alert" title="Storage problem">{error}</Notice>}
      {loading ? <p role="status" className="p-6 text-center text-slate-600">Loading your {mode === 'demo' ? 'demo ' : ''}records…</p> : <Page path={path} />}
    </Layout>
  );
}
