import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btnBase = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-[0.95rem] font-semibold tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const btnVariant: Record<Variant, string> = {
  primary: 'border-teal-700 bg-teal-700 text-white shadow-sm hover:border-teal-800 hover:bg-teal-800',
  secondary: 'border-slate-300 bg-white text-slate-800 shadow-sm hover:border-slate-400 hover:bg-slate-50',
  ghost: 'border-transparent bg-transparent text-teal-800 hover:bg-teal-50',
  danger: 'border-red-700 bg-red-700 text-white shadow-sm hover:bg-red-800',
};

export function Button({ variant = 'secondary', className, icon, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName }) {
  return (
    <button type="button" {...p} className={cx(btnBase, btnVariant[variant], className)}>
      {icon && <Icon name={icon} className="h-[1.1em] w-[1.1em]" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = 'secondary', className, icon }: { href: string; children: ReactNode; variant?: Variant; className?: string; icon?: IconName }) {
  return (
    <a href={href} className={cx(btnBase, btnVariant[variant], 'no-underline', className)}>
      {icon && <Icon name={icon} className="h-[1.1em] w-[1.1em]" />}
      {children}
    </a>
  );
}

/** Small tinted icon tile used in card headers. */
export function IconTile({ name, tone = 'teal', className }: { name: IconName; tone?: 'teal' | 'blue' | 'orange' | 'green' | 'slate' | 'violet'; className?: string }) {
  const t = { teal: 'bg-teal-50 text-teal-700 ring-teal-100', blue: 'bg-blue-50 text-[#2a78d6] ring-blue-100', orange: 'bg-orange-50 text-[#c9521f] ring-orange-100', green: 'bg-emerald-50 text-[#138a5f] ring-emerald-100', slate: 'bg-slate-100 text-slate-600 ring-slate-200', violet: 'bg-violet-50 text-violet-700 ring-violet-100' }[tone];
  return (
    <span className={cx('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', t, className)} aria-hidden="true">
      <Icon name={name} className="h-[18px] w-[18px]" />
    </span>
  );
}

export function Card({ title, subtitle, icon, iconTone, children, className, actions, as: As = 'section', titleId }: { title?: ReactNode; subtitle?: ReactNode; icon?: IconName; iconTone?: Parameters<typeof IconTile>[0]['tone']; children: ReactNode; className?: string; actions?: ReactNode; as?: 'section' | 'div' | 'article'; titleId?: string }) {
  return (
    <As className={cx('rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.03)] sm:p-5', className)} aria-labelledby={titleId}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <IconTile name={icon} tone={iconTone} />}
            <div className="min-w-0">
              {title && <h2 id={titleId} className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>}
              {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      {children}
    </As>
  );
}

export function PageTitle({ children, sub, actions, eyebrow }: { children: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-2 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-medium text-teal-700">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]" tabIndex={-1} id="page-title">{children}</h1>
        {sub && <p className="mt-1 max-w-3xl text-[0.95rem] text-slate-600">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  check?: string | null;
  optional?: boolean;
}

function Shell({ id, label, hint, error, check, optional, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label} {optional && <span className="font-normal text-slate-500">(optional)</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="text-sm text-slate-500">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-err`} className="flex items-start gap-1.5 text-sm font-medium text-red-700" role="alert">
          <Icon name="xCircle" className="mt-0.5 h-4 w-4" /> {error}
        </p>
      )}
      {!error && check && (
        <p id={`${id}-err`} className="flex items-start gap-1.5 text-sm font-medium text-amber-800">
          <Icon name="alert" className="mt-0.5 h-4 w-4" /> <span><span className="sr-only">Please check: </span>{check}</span>
        </p>
      )}
    </div>
  );
}

const inputCls = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] placeholder:text-slate-400 hover:border-slate-400 disabled:bg-slate-50 disabled:text-slate-500';

export function TextField({ label, hint, error, check, optional, className, ...p }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const gen = useId();
  const id = p.id ?? gen;
  const describedBy = [hint && `${id}-hint`, (error || check) && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <Shell id={id} label={label} hint={hint} error={error} check={check} optional={optional}>
      <input {...p} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cx(inputCls, error && 'border-red-600 ring-1 ring-red-600', !error && check && 'border-amber-600 ring-1 ring-amber-500', className)} />
    </Shell>
  );
}

export function SelectField({ label, hint, error, optional, children, ...p }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const gen = useId();
  const id = p.id ?? gen;
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      <select {...p} id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={inputCls}>
        {children}
      </select>
    </Shell>
  );
}

export function TextArea({ label, hint, error, optional, ...p }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const gen = useId();
  const id = p.id ?? gen;
  return (
    <Shell id={id} label={label} hint={hint} error={error} optional={optional}>
      <textarea rows={3} {...p} id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={inputCls} />
    </Shell>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded accent-teal-700" aria-describedby={hint ? `${id}-h` : undefined} />
      <label htmlFor={id} className="text-slate-800">
        {label}
        {hint && <span id={`${id}-h`} className="block text-sm text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}

export function RadioGroup<T extends string>({ legend, value, onChange, options, name }: { legend: ReactNode; value: T | null; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode }[]; name: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-slate-800">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label key={o.value} className={cx('flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', value === o.value ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600' : 'border-slate-300 bg-white hover:border-slate-400')}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 h-5 w-5 accent-teal-700" />
            <span>
              <span className="font-medium text-slate-900">{o.label}</span>
              {o.hint && <span className="block text-sm text-slate-500">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Collapsed-by-default section for optional fields. */
export function Optional({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-90" /> {summary}
      </summary>
      <div className="flex flex-col gap-4 border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

export type Tone = 'info' | 'ok' | 'warn' | 'danger' | 'neutral' | 'demo';
const toneCls: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-900 border-sky-200',
  ok: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warn: 'bg-amber-50 text-amber-900 border-amber-300',
  danger: 'bg-red-50 text-red-900 border-red-300',
  neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  demo: 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300',
};
const toneIcon: Record<Tone, IconName> = { info: 'info', ok: 'checkCircle', warn: 'alert', danger: 'xCircle', neutral: 'circle', demo: 'flask' };

/** Status chip with icon + text so meaning never depends on colour alone. */
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: IconName }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.8rem] font-semibold', toneCls[tone])}>
      <Icon name={icon ?? toneIcon[tone]} className="h-3.5 w-3.5" strokeWidth={2.25} />
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, role, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status'; icon?: IconName }) {
  return (
    <div className={cx('rounded-xl border p-3.5', toneCls[tone])} role={role}>
      <div className="flex gap-3">
        <Icon name={icon ?? toneIcon[tone]} className="mt-0.5 h-5 w-5" />
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cx('text-sm leading-relaxed [&_a]:font-medium [&_a]:underline', !!title && 'mt-0.5')}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function Empty({ children, icon = 'list' }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-slate-500">
      <Icon name={icon} className="h-6 w-6 text-slate-400" />
      <p className="text-sm">{children}</p>
    </div>
  );
}

/** Taken / skipped / not recorded marker with an accessible label. */
export function DoseMark({ status, label }: { status: 'taken' | 'skipped' | 'not_recorded'; label?: string }) {
  const text = status === 'taken' ? 'recorded as taken' : status === 'skipped' ? 'recorded as skipped' : 'not recorded';
  const cls = status === 'taken' ? 'bg-emerald-600 text-white' : status === 'skipped' ? 'bg-white text-slate-600 ring-1 ring-slate-400' : 'bg-transparent text-slate-300';
  return (
    <span role="img" aria-label={label ? `${label}: ${text}` : text} title={label ? `${label}: ${text}` : text} className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full', cls)}>
      {status === 'taken' ? <Icon name="check" className="h-3 w-3" strokeWidth={3} /> : status === 'skipped' ? <Icon name="skip" className="h-3 w-3" strokeWidth={2.5} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
    </span>
  );
}

export function DoseLegend() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5"><DoseMark status="taken" /> Recorded as taken</span>
      <span className="inline-flex items-center gap-1.5"><DoseMark status="skipped" /> Recorded as skipped</span>
      <span className="inline-flex items-center gap-1.5"><DoseMark status="not_recorded" /> Not recorded</span>
    </p>
  );
}

/** Accessible modal dialog using the native <dialog> element (focus trapped, Esc closes). */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} className="m-auto w-[min(40rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]">
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <h2 id={id} className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation that requires typing a word, for destructive actions. */
export function TypedConfirm({ open, onClose, onConfirm, title, word, children, confirmLabel }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; word: string; children: ReactNode; confirmLabel: string }) {
  const [v, setV] = useState('');
  useEffect(() => { if (!open) setV(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="danger" disabled={v.trim().toUpperCase() !== word} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <div className="flex flex-col gap-3">
        {children}
        <TextField label={<>Type <strong>{word}</strong> to confirm</>} value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" />
      </div>
    </Modal>
  );
}

// ---- Toasts (live region) ----
interface Toast { id: number; text: string; tone: Tone }
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-3 md:bottom-6 print:hidden">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg', toneCls[t.tone])}>
            <Icon name={toneIcon[t.tone]} className="mt-0.5 h-4 w-4" /> {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200/70">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

/** Shared table styling. */
export const tableCls = {
  wrap: 'overflow-x-auto rounded-lg ring-1 ring-slate-200',
  table: 'w-full text-left text-sm',
  thead: 'bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500',
  th: 'px-3 py-2.5 font-semibold',
  tr: 'border-t border-slate-100 hover:bg-slate-50/60',
  td: 'px-3 py-2.5 align-top',
};

/**
 * Number input that keeps exactly what the user types and only reports a value
 * once it is valid, so partially-typed numbers ("", "8", "85.") are never
 * snapped back or reformatted mid-typing.
 */
export function NumberField({ value, onValid, isValid, invalidMessage, format = (n) => String(n), ...p }: FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null; onValid: (n: number | null) => void; isValid: (n: number | null) => boolean; invalidMessage: string; format?: (n: number) => string }) {
  const [text, setText] = useState(value == null ? '' : format(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value == null ? '' : format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const parsed = text.trim() === '' ? null : Number(text);
  const valid = (parsed === null || Number.isFinite(parsed)) && isValid(parsed);
  return (
    <TextField
      {...p}
      inputMode="decimal"
      value={text}
      error={!valid && !focused ? invalidMessage : p.error}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.trim();
        const n = t === '' ? null : Number(t);
        if ((n === null || Number.isFinite(n)) && isValid(n)) onValid(n);
      }}
    />
  );
}
