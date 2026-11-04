import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Packager } from '../api';
import { formatRupees, parseRupees } from '../money';
import { AgencyLink, Empty, Field, Loading, Notice, PageHeader, Panel, useAction, useApi } from '../ui';

export function Agencies() {
  const navigate = useNavigate();
  const [archived, setArchived] = useState(false);
  const agencies = useApi<{ items: Packager[] }>(`/packagers?limit=100&include_archived=${archived}`);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [limit, setLimit] = useState('');
  const { busy, error, setError, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const credit = limit.trim() ? parseRupees(limit) : null;
    if (limit.trim() && credit === null) { setError(new Error('Enter the credit limit in rupees, such as 50000.')); return; }
    void run(async () => {
      const created = await api<{ packager: Packager }>('/packagers', { method: 'POST',
        body: { name, phone: phone.trim() || null, credit_limit_paise: credit } });
      navigate(`/agencies/${created.packager.id}`);
    });
  };
  const items = [...(agencies.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Agencies" subtitle="The travel agencies you book for" />
      <Panel title="Add an agency">
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="Name"><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Phone (optional)"><input type="tel" maxLength={30} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
            <Field label="Credit limit (₹)" hint="Leave blank for no limit."><input inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} /></Field>
          </div>
          <Notice error={error} />
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Add agency'}</button>
        </form>
      </Panel>
      <Panel title="All agencies" action={
        <label className="check"><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived</label>
      }>
        <Notice error={agencies.error} />
        {agencies.loading ? <Loading /> : !items.length ? <Empty>No agencies yet. Add your first one above.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Agency</th><th>Phone</th><th className="num">Credit limit</th></tr></thead>
            <tbody>{items.map((agency) => (
              <tr key={agency.id}>
                <td><AgencyLink id={agency.id} name={agency.name} />{agency.is_archived && <span className="badge neutral"> Archived</span>}</td>
                <td>{agency.phone ?? '—'}</td>
                <td className="num">{agency.credit_limit_paise === null ? 'No limit' : formatRupees(agency.credit_limit_paise)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
