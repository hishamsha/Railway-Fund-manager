import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, Plus } from 'lucide-react';
import { api, type Packager } from '../api';
import { formatDate, formatRupees, paiseToInput, parseRupees } from '../money';
import { Due, Empty, Field, Loading, Notice, PageHeader, Panel, Route, Stat, useAction, useApi } from '../ui';
import { RuleEditor } from './Charges';

type AgencyUser = { id: string; email: string; display_name: string | null; is_active: boolean; password_set: boolean };
type Statement = { summary: { booking_count: number; total_payable_paise: number; collected_paise: number; net_due_paise: number; net_credit_paise: number };
  items: Array<{ id: string; boarding_station: string; destination_station: string; journey_date: string; total_payable_paise: number;
    collected_paise: number; balance_due_paise: number }>; next_offset: number | null };
type SetupCode = { email: string; code: string; expires: string };

function SetupCodeNotice({ setup }: { setup: SetupCode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="notice good" role="status">
      <p><strong>Setup code for {setup.email}</strong>. Send it to the agency now, because it won't be shown again. It works once, until {new Date(setup.expires).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}. The agency uses it to set a password.</p>
      <div className="row">
        <code>{setup.code}</code>
        <button type="button" className="ghost" onClick={() => void navigator.clipboard.writeText(setup.code).then(() => setCopied(true))}>
          <Copy aria-hidden="true" size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Logins({ packagerId, archived }: { packagerId: string; archived: boolean }) {
  const users = useApi<{ items: AgencyUser[] }>(`/agency-users?packager_id=${packagerId}`);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [setup, setSetup] = useState<SetupCode | null>(null);
  const { busy, error, run } = useAction();
  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const created = await api<{ agency_user: AgencyUser; setup_code: string; setup_code_expires_at: string }>('/agency-users', {
        method: 'POST', body: { packager_id: packagerId, email, display_name: name.trim() || null } });
      setSetup({ email: created.agency_user.email, code: created.setup_code, expires: created.setup_code_expires_at });
      setEmail(''); setName('');
      users.reload();
    });
  };
  const newCode = (user: AgencyUser) => void run(async () => {
    const issued = await api<{ setup_code: string; setup_code_expires_at: string }>(`/agency-users/${user.id}/setup-code`, { method: 'POST' });
    setSetup({ email: user.email, code: issued.setup_code, expires: issued.setup_code_expires_at });
  });
  const setActive = (user: AgencyUser, active: boolean) => {
    if (!active && !window.confirm(`Turn off the login for ${user.email}? It will be signed out straight away.`)) return;
    void run(async () => {
      await api(`/agency-users/${user.id}`, { method: 'PATCH', body: { is_active: active } });
      users.reload();
    });
  };
  return (
    <Panel title="Agency logins">
      {setup && <SetupCodeNotice setup={setup} />}
      <Notice error={users.error ?? error} />
      {users.data?.items.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{users.data.items.map((user) => (
            <tr key={user.id}>
              <td>{user.email}{user.display_name && <div className="muted small">{user.display_name}</div>}</td>
              <td>{!user.is_active ? <span className="badge danger">Off</span> : user.password_set
                ? <span className="badge good">Active</span> : <span className="badge warn">Waiting for password</span>}</td>
              <td><div className="row">
                {user.is_active && <button className="ghost" disabled={busy} onClick={() => newCode(user)}>New setup code</button>}
                <button className="ghost" disabled={busy} onClick={() => setActive(user, !user.is_active)}>{user.is_active ? 'Turn off' : 'Turn on'}</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>This agency has no login yet.</Empty>}
      {!archived && (
        <form onSubmit={create}>
          <div className="form-grid">
            <Field label="Email"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
            <Field label="Name (optional)"><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          </div>
          <button className="primary" disabled={busy}>Create login</button>
        </form>
      )}
    </Panel>
  );
}

export function AgencyDetail() {
  const { id } = useParams();
  const agency = useApi<{ packager: Packager }>(`/packagers/${id}`);
  const statement = useApi<Statement>(`/packagers/${id}/statement?limit=50`);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [limit, setLimit] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();
  const packager = agency.data?.packager;
  useEffect(() => {
    if (!packager) return;
    setName(packager.name); setPhone(packager.phone ?? ''); setNotes(packager.notes ?? '');
    setLimit(packager.credit_limit_paise === null ? '' : paiseToInput(packager.credit_limit_paise));
  }, [packager]);
  if (agency.error) return <Notice error={agency.error} />;
  if (!packager) return <Loading />;
  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const credit = limit.trim() ? parseRupees(limit) : null;
    if (limit.trim() && credit === null) { setError(new Error('Enter the credit limit in rupees, such as 50000.')); return; }
    void run(async () => {
      await api(`/packagers/${id}`, { method: 'PATCH', body: { name, phone: phone.trim() || null, notes: notes.trim() || null, credit_limit_paise: credit } });
      setSaved(true);
      agency.reload();
    });
  };
  const archive = () => {
    if (!packager.is_archived && !window.confirm(`Archive ${packager.name}? Its bookings stay, but its portal closes and no new bookings can be made.`)) return;
    void run(async () => {
      await api(`/packagers/${id}`, { method: 'PATCH', body: { is_archived: !packager.is_archived } });
      agency.reload();
    });
  };
  const summary = statement.data?.summary;
  return (
    <>
      <PageHeader title={packager.name} subtitle={packager.is_archived ? 'Archived' : packager.phone ?? undefined}
        action={!packager.is_archived && <Link className="button primary" to={`/bookings/new?packager_id=${id}`}><Plus aria-hidden="true" size={16} /> New booking</Link>} />
      {summary && (
        <div className="stats">
          <Stat label="Due" value={formatRupees(summary.net_due_paise)} tone={summary.net_due_paise > 0 ? 'danger' : undefined} />
          <Stat label="Collected" value={formatRupees(summary.collected_paise)} />
          <Stat label="Total billed" value={formatRupees(summary.total_payable_paise)} />
          <Stat label="Bookings" value={String(summary.booking_count)} />
        </div>
      )}
      <Panel title="Agency details">
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Name"><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Phone"><input type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
            <Field label="Credit limit (₹)" hint="Leave blank for no limit. The agency can see this."><input inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
          </div>
          <Field label="Notes (private)"><textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <Notice error={error} />
          {saved && !error && <div className="notice good" role="status">Saved.</div>}
          <div className="row">
            <button className="primary" disabled={busy}>Save changes</button>
            <button type="button" className="ghost" disabled={busy} onClick={archive}>{packager.is_archived ? 'Restore agency' : 'Archive agency'}</button>
          </div>
        </form>
      </Panel>
      <Logins packagerId={packager.id} archived={packager.is_archived} />
      <Panel title="This agency's service charges"><RuleEditor packagerId={packager.id} /></Panel>
      <Panel title="Bookings">
        <Notice error={statement.error} />
        {!statement.data?.items.length ? <Empty>No bookings yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Date</th><th className="num">Payable</th><th className="num">Collected</th><th className="num">Due</th></tr></thead>
            <tbody>{statement.data.items.map((item) => (
              <tr key={item.id}>
                <td><Link to={`/bookings/${item.id}`}><Route from={item.boarding_station} to={item.destination_station} /></Link></td>
                <td className="nowrap">{formatDate(item.journey_date)}</td>
                <td className="num">{formatRupees(item.total_payable_paise)}</td>
                <td className="num">{formatRupees(item.collected_paise)}</td>
                <td className="num"><Due paise={item.balance_due_paise} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {statement.data?.next_offset != null && <p className="muted small"><Link to={`/bookings?packager_id=${id}`}>See all bookings for this agency</Link></p>}
      </Panel>
    </>
  );
}
