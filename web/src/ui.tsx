import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure, api, ticketStatuses, type Packager } from './api';
import { formatRupees } from './money';

/** Loads a GET path; pass null to wait. `reload` refetches without clearing what is shown. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((result) => { if (live) { setData(result); setError(null); } })
      .catch((failure: Error) => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading: path !== null && data === null && error === null, reload };
}

/** Runs a save action and keeps its busy state and error together. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | Error | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); return true; } catch (failure) { setError(failure as Error); return false; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

export function usePackagers() {
  const { data } = useApi<{ items: Packager[] }>('/packagers?limit=100');
  return [...(data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  );
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      {(title || action) && <div className="panel-head">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'good' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

export function Notice({ error }: { error: string | Error | null | undefined }) {
  if (!error) return null;
  const failure = error instanceof ApiFailure ? error : null;
  const fields = failure?.fields ? Object.entries(failure.fields)
    .map(([name, messages]) => `${name.replaceAll('_', ' ')}: ${messages?.join(', ')}`) : [];
  return (
    <div className="notice danger" role="alert">
      {typeof error === 'string' ? error : error.message}
      {fields.length > 0 && <ul>{fields.map((line) => <li key={line}>{line}</li>)}</ul>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading() { return <p className="empty" role="status">Loading…</p>; }

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

const statusTone: Record<string, string> = { requested: 'neutral', booked: 'info', confirmed: 'good', waitlisted: 'warn',
  rac: 'warn', cancelled: 'danger', travelled: 'neutral', pending: 'warn', quoted: 'info', accepted: 'good', declined: 'danger' };

export function statusLabel(status: string): string {
  return status === 'rac' ? 'RAC' : status[0]!.toUpperCase() + status.slice(1);
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusTone[status] ?? 'neutral'}`}>{statusLabel(status)}</span>;
}

export function StatusSelect({ value, onChange, disabled, label }: { value: string; onChange: (status: string) => void;
  disabled?: boolean; label: string }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {ticketStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
    </select>
  );
}

export function Due({ paise }: { paise: number }) {
  return <span className={paise > 0 ? 'danger-text' : 'good-text'}>{formatRupees(paise)}</span>;
}

export function Route({ from, to }: { from: string; to: string }) {
  return <>{from} <span aria-hidden="true">→</span><span className="sr-only"> to </span> {to}</>;
}

export function AgencyLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/agencies/${id}`}>{name}</Link>;
}
