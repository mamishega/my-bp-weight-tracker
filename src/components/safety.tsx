import { EMERGENCY, GUIDANCE_CHECKED_ON, GUIDANCE_REVIEW_DUE, MEASUREMENT_STEPS, SAFETY_STATEMENT, SOURCES, URGENT_SYMPTOMS, NO_NUMERIC_EMERGENCY_NOTE } from '../lib/guidance';
import { formatDateLong } from '../lib/time';
import { Icon } from './Icon';

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

export function guidanceOverdue(today = new Date().toISOString().slice(0, 10)): boolean {
  return today > GUIDANCE_REVIEW_DUE;
}

export function ReviewDate() {
  return (
    <div className="mt-2 text-xs text-slate-600">
      <p>Sources checked {formatDateLong(GUIDANCE_CHECKED_ON)}. Due for review by {formatDateLong(GUIDANCE_REVIEW_DUE)}.</p>
      {guidanceOverdue() && (
        <p className="mt-1 flex items-start gap-1.5 font-semibold text-amber-800" role="note">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5" /> This guidance is past its review date. Check the linked sources for any updates.
        </p>
      )}
    </div>
  );
}

/** Urgent guidance. Always rendered BEFORE any form, never behind one. */
export function UrgentHelp({ compact = false }: { compact?: boolean }) {
  return (
    <aside aria-labelledby="urgent-h" className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-red-100 bg-red-50 px-4 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-600 text-white" aria-hidden="true"><Icon name="alert" className="h-[18px] w-[18px]" /></span>
        <h2 id="urgent-h" className="flex-1 font-semibold tracking-tight text-red-900">Urgent symptoms? Call {EMERGENCY.label} now</h2>
        <a href="tel:000" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white no-underline shadow-sm hover:bg-red-700">
          <Icon name="phone" className="h-4 w-4" /> Call 000
        </a>
      </div>
      <div className="px-4 py-3 text-sm text-slate-700">
        <p>Don’t wait to finish a form or take another reading. Call 000 if you have:</p>
        <ul className={`mt-2 grid list-disc gap-x-6 gap-y-1 pl-5 ${compact ? '' : 'sm:grid-cols-2'}`}>
          {(compact ? URGENT_SYMPTOMS.slice(0, 4) : URGENT_SYMPTOMS).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="mt-2">
          This applies even if your reading is within your personal target. {EMERGENCY.mobileNote} For non-urgent advice, call the {EMERGENCY.healthdirectLabel} on{' '}
          <a href="tel:1800022222" className="font-semibold text-teal-800 underline">{EMERGENCY.healthdirect}</a>.
        </p>
        <p className="mt-1 font-medium text-slate-900">This app cannot contact emergency services or anyone else for you.</p>
        {!compact && (
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-teal-800 underline">Sources, and why there is no number-based alarm</summary>
            <p className="mt-1">{NO_NUMERIC_EMERGENCY_NOTE}</p>
            <SourceLinks keys={['highBP', 'heartAttack', 'stroke', 'homeMonitoring']} />
            <ReviewDate />
          </details>
        )}
      </div>
    </aside>
  );
}

export function MeasurementGuide({ open = false }: { open?: boolean }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" open={open}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 py-2 font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-90" />
        <Icon name="info" className="h-[18px] w-[18px] text-sky-600" /> How to measure (Australian guidance)
      </summary>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {MEASUREMENT_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <SourceLinks keys={['homeMonitoring', 'racgpHome']} />
      <div className="pb-3"><ReviewDate /></div>
    </details>
  );
}

export function SafetyStatement() {
  return <p className="flex gap-2 text-sm text-slate-500"><Icon name="shield" className="mt-0.5 h-4 w-4" />{SAFETY_STATEMENT}</p>;
}

export function PrivacySummary() {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
      <li>Your records are stored only in this browser on this device, using IndexedDB. No account is needed.</li>
      <li>Records do <strong>not</strong> sync between devices or browsers. Clearing browser or site data can permanently delete them, so make regular backups.</li>
      <li>Records are <strong>not encrypted</strong> unless you turn on the optional <strong>passcode lock</strong> below. Without it, anyone who can use this browser profile could view them. Even with it, someone with access while the app is unlocked could see them.</li>
      <li>No health information is sent to analytics, advertising, AI services or any other third party. The app makes no network requests with your data.</li>
      <li>Exported backups, CSV files and printed reports contain sensitive personal health information. Store and share them carefully.</li>
    </ul>
  );
}
