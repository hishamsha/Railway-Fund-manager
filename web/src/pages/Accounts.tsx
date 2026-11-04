import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type BookingAccount } from '../api';
import { formatRupees } from '../money';
import { Empty, Field, Loading, Notice, PageHeader, Panel, useAction, useApi } from '../ui';

type Usage = { usage: { ticket_count: number; cancelled_count: number; fare_total_paise: number } };
const kindLabel: Record<string, string> = { personal_id: 'Personal IRCTC ID', agent_portal: 'Agent portal' };

function AccountRow({ account, onChanged }: { account: BookingAccount; onChanged: () => void }) {
  const usage = useApi<Usage>(`/booking-accounts/${account.id}/usage`);
  const { busy, error, run } = useAction();
  const toggle = () => void run(async () => {
    await api(`/booking-accounts/${account.id}`, { method: 'PATCH', body: { is_active: !account.is_active } });
    onChanged();
  });
  return (
    <>
      <tr>
        <td><Link to={`/tickets?booking_account_id=${account.id}`}>{account.name}</Link>
          {!account.is_active && <span className="badge neutral"> Archived</span>}
          {account.login_id && <div className="muted small">{account.login_id}</div>}</td>
        <td>{kindLabel[account.kind] ?? account.kind}</td>
        <td className="num">{usage.data?.usage.ticket_count ?? '…'}</td>
        <td className="num">{usage.data ? formatRupees(usage.data.usage.fare_total_paise) : '…'}</td>
        <td><button className="ghost" disabled={busy} onClick={toggle}>{account.is_active ? 'Archive' : 'Restore'}</button></td>
      </tr>
      {error && <tr><td colSpan={5}><Notice error={error} /></td></tr>}
    </>
  );
}

export function Accounts() {
  const [archived, setArchived] = useState(false);
  const accounts = useApi<{ items: BookingAccount[] }>(`/booking-accounts?include_inactive=${archived}`);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('personal_id');
  const [loginId, setLoginId] = useState('');
  const { busy, error, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api('/booking-accounts', { method: 'POST', body: { name, kind, login_id: loginId.trim() || null } });
      setName(''); setLoginId('');
      accounts.reload();
    });
  };
  return (
    <>
      <PageHeader title="Booking accounts" subtitle="The IRCTC IDs and portals you buy tickets from. Agencies never see these." />
      <Panel title="Add an account">
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Name"><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Hisham IRCTC" /></Field>
            <Field label="Type"><select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="personal_id">Personal IRCTC ID</option><option value="agent_portal">Agent portal</option>
            </select></Field>
            <Field label="Login name (optional)" hint="Never enter a password here."><input maxLength={160} autoComplete="off" value={loginId} onChange={(event) => setLoginId(event.target.value)} /></Field>
          </div>
          <Notice error={error} />
          <button className="primary" disabled={busy}>Add account</button>
        </form>
      </Panel>
      <Panel title="Accounts" action={
        <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived</label>
      }>
        <Notice error={accounts.error} />
        {accounts.loading ? <Loading /> : !accounts.data?.items.length ? <Empty>No accounts yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Account</th><th>Type</th><th className="num">Tickets</th><th className="num">Fares</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{accounts.data.items.map((account) => <AccountRow key={account.id} account={account} onChanged={accounts.reload} />)}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
