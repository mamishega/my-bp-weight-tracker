import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const v: Record<Variant, string> = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 border-teal-700',
    secondary: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
    ghost: 'bg-transparent text-teal-800 hover:bg-teal-50 border-transparent',
    danger: 'bg-red-700 text-white hover:bg-red-800 border-red-700',
  };
  return (
    <button
      type="button"
      {...p}
      className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-base font-medium disabled:cursor-not-allowed disabled:opacity-50', v[variant], className)}
    />
  );
}

export function LinkButton({ href, children, variant = 'secondary', className }: { href: string; children: ReactNode; variant?: Variant; className?: string }) {
  const v: Record<Variant, string> = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 border-teal-700',
    secondary: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
    ghost: 'bg-transparent text-teal-800 hover:bg-teal-50 border-transparent',
    danger: 'bg-red-700 text-white border-red-700',
  };
  return (
    <a href={href} className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-base font-medium no-underline', v[variant], className)}>
      {children}
    </a>
  );
}

export function Card({ title, children, className, actions, as: As = 'section', titleId }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; as?: 'section' | 'div' | 'article'; titleId?: string }) {
  return (
    <As className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)} aria-labelledby={titleId}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          {title && <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </As>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl" tabIndex={-1} id="page-title">{children}</h1>
      {sub && <p className="mt-1 text-slate-600">{sub}</p>}
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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-slate-800">
        {label} {optional && <span className="font-normal text-slate-500">(optional)</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="text-sm text-slate-600">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-err`} className="flex items-start gap-1 text-sm font-medium text-red-800" role="alert">
          <span aria-hidden="true">⛔</span> {error}
        </p>
      )}
      {!error && check && (
        <p id={`${id}-err`} className="flex items-start gap-1 text-sm font-medium text-amber-900">
          <span aria-hidden="true">⚠️</span> <span><span className="sr-only">Please check: </span>{check}</span>
        </p>
      )}
    </div>
  );
}

const inputCls = 'min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-slate-900';

export function TextField({ label, hint, error, check, optional, className, ...p }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const gen = useId();
  const id = p.id ?? gen;
  const describedBy = [hint && `${id}-hint`, (error || check) && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <Shell id={id} label={label} hint={hint} error={error} check={check} optional={optional}>
      <input {...p} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={cx(inputCls, error && 'border-red-700 ring-1 ring-red-700', !error && check && 'border-amber-700', className)} />
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
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-teal-700" aria-describedby={hint ? `${id}-h` : undefined} />
      <label htmlFor={id} className="text-slate-800">
        {label}
        {hint && <span id={`${id}-h`} className="block text-sm text-slate-600">{hint}</span>}
      </label>
    </div>
  );
}

export function RadioGroup<T extends string>({ legend, value, onChange, options, name }: { legend: ReactNode; value: T | null; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode }[]; name: string }) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium text-slate-800">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label key={o.value} className={cx('flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-3', value === o.value ? 'border-teal-700 bg-teal-50 ring-1 ring-teal-700' : 'border-slate-300 bg-white')}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 h-5 w-5 accent-teal-700" />
            <span>
              <span className="font-medium">{o.label}</span>
              {o.hint && <span className="block text-sm text-slate-600">{o.hint}</span>}
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
    <details className="group rounded-lg border border-slate-200 bg-slate-50" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 font-medium text-slate-800">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">▸</span> {summary}
      </summary>
      <div className="flex flex-col gap-4 border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}

type Tone = 'info' | 'ok' | 'warn' | 'danger' | 'neutral' | 'demo';
const toneCls: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-950 border-sky-300',
  ok: 'bg-emerald-50 text-emerald-950 border-emerald-300',
  warn: 'bg-amber-50 text-amber-950 border-amber-400',
  danger: 'bg-red-50 text-red-950 border-red-400',
  neutral: 'bg-slate-100 text-slate-800 border-slate-300',
  demo: 'bg-fuchsia-50 text-fuchsia-950 border-fuchsia-400',
};
const toneIcon: Record<Tone, string> = { info: 'ℹ️', ok: '✅', warn: '⚠️', danger: '🚨', neutral: '•', demo: '🧪' };

/** Status chip with icon + text so meaning never depends on colour alone. */
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium', toneCls[tone])}>
      <span aria-hidden="true">{icon ?? toneIcon[tone]}</span>
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, role }: { tone?: Tone; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={cx('rounded-xl border p-3', toneCls[tone])} role={role}>
      <div className="flex gap-2">
        <span aria-hidden="true">{toneIcon[tone]}</span>
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className="text-sm leading-relaxed [&_a]:underline">{children}</div>}
        </div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-slate-600">{children}</p>;
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
    <dialog ref={ref} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} className="m-auto w-[min(40rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-300 p-0 shadow-xl backdrop:bg-slate-900/50">
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <h2 id={id} className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg text-xl" aria-label="Close">✕</button>
          </div>
          <div className="overflow-y-auto p-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">{footer}</div>}
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
          <div key={t.id} className={cx('pointer-events-auto max-w-md rounded-xl border px-4 py-3 shadow-lg', toneCls[t.tone])}>
            <span aria-hidden="true">{toneIcon[t.tone]} </span>{t.text}
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
    <div>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-sm text-slate-600">{sub}</p>}
    </div>
  );
}
