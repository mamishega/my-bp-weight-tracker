import { EMERGENCY, GUIDANCE_CHECKED_ON, GUIDANCE_REVIEW_DUE, MEASUREMENT_STEPS, SAFETY_STATEMENT, SOURCES, URGENT_SYMPTOMS, NO_NUMERIC_EMERGENCY_NOTE } from '../lib/guidance';
import { formatDateLong } from '../lib/time';

function SourceLinks({ keys }: { keys: (keyof typeof SOURCES)[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
      {keys.map((k) => {
        const s = SOURCES[k];
        return (
          <li key={k}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
              {s.publisher}: {s.title}
            </a>{' '}
            <span className="text-slate-600">({s.sourceReviewed})</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewDate() {
  return (
    <p className="mt-2 text-xs text-slate-600">
      Sources checked {formatDateLong(GUIDANCE_CHECKED_ON)}. Due for review by {formatDateLong(GUIDANCE_REVIEW_DUE)}.
    </p>
  );
}

/** Urgent guidance. Always rendered BEFORE any form, never behind one. */
export function UrgentHelp({ compact = false }: { compact?: boolean }) {
  return (
    <aside aria-labelledby="urgent-h" className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-red-950">
      <h2 id="urgent-h" className="flex items-center gap-2 text-lg font-bold">
        <span aria-hidden="true">🚨</span> Urgent symptoms? Call {EMERGENCY.label} now
      </h2>
      <p className="mt-1">
        Do not wait to finish a form or take another reading. Call <a href="tel:000" className="font-bold underline">000</a> if you have:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {(compact ? URGENT_SYMPTOMS.slice(0, 4) : URGENT_SYMPTOMS).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        This applies even if your reading is within your personal target. {EMERGENCY.mobileNote} For non-urgent health advice, call the {EMERGENCY.healthdirectLabel} on{' '}
        <a href="tel:1800022222" className="font-semibold underline">{EMERGENCY.healthdirect}</a>.
      </p>
      <p className="mt-2 text-sm font-medium">This app cannot contact emergency services or anyone else for you.</p>
      {!compact && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-medium underline">Sources and why there is no number-based alarm</summary>
          <p className="mt-1">{NO_NUMERIC_EMERGENCY_NOTE}</p>
          <SourceLinks keys={['highBP', 'heartAttack', 'stroke', 'homeMonitoring']} />
          <ReviewDate />
        </details>
      )}
    </aside>
  );
}

export function MeasurementGuide({ open = false }: { open?: boolean }) {
  return (
    <details className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sky-950" open={open}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">How to measure (Australian guidance)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {MEASUREMENT_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <SourceLinks keys={['homeMonitoring', 'racgpHome']} />
      <ReviewDate />
    </details>
  );
}

export function SafetyStatement() {
  return <p className="text-sm text-slate-700">{SAFETY_STATEMENT}</p>;
}

export function PrivacySummary() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      <li>Your records are stored only in this browser on this device, using IndexedDB. No account is needed.</li>
      <li>Records do <strong>not</strong> sync between devices or browsers. Clearing browser or site data can permanently delete them, so make regular backups.</li>
      <li>Browser storage in this app is <strong>not encrypted</strong> by the app. Anyone who can use this browser profile could view the records.</li>
      <li>No health information is sent to analytics, advertising, AI services or any other third party. The app makes no network requests with your data.</li>
      <li>Exported backups, CSV files and printed reports contain sensitive personal health information. Store and share them carefully.</li>
    </ul>
  );
}
