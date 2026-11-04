import { useState } from 'react';
import { formatDate, formatRupees } from '../money';
import { AgencyLink, Due, Empty, Loading, Notice, PageHeader, Panel, Stat, useApi } from '../ui';

type Item = { packager_id: string; name: string; phone: string | null; booking_count: number; net_due_paise: number;
  advance_credit_paise: number; overdue_paise: number; oldest_due_date: string | null; credit_limit_paise: number | null;
  available_credit_paise: number | null; over_limit: boolean };
type Pending = { items: Item[]; totals: { net_due_paise: number; overdue_paise: number; over_limit_count: number } };

export function Payments() {
  const [everyone, setEveryone] = useState(false);
  const pending = useApi<Pending>(`/finance/pending-agencies?include_settled=${everyone}`);
  return (
    <>
      <PageHeader title="Payments & credit" subtitle="What each agency owes overall. An advance on one booking is set against dues on its others, so an agency in credit is not listed here until you show settled agencies." />
      <Notice error={pending.error} />
      {pending.data && (
        <div className="stats">
          <Stat label="Total due" value={formatRupees(pending.data.totals.net_due_paise)} tone={pending.data.totals.net_due_paise > 0 ? 'danger' : undefined} />
          <Stat label="Overdue" value={formatRupees(pending.data.totals.overdue_paise)} tone={pending.data.totals.overdue_paise > 0 ? 'danger' : undefined} />
          <Stat label="Over credit limit" value={String(pending.data.totals.over_limit_count)} tone={pending.data.totals.over_limit_count > 0 ? 'danger' : undefined} />
        </div>
      )}
      <Panel title={everyone ? 'All agencies' : 'Agencies with money due'} action={
        <label className="check"><input type="checkbox" checked={everyone} onChange={(event) => setEveryone(event.target.checked)} /> Show settled agencies</label>
      }>
        {pending.loading ? <Loading /> : !pending.data?.items.length ? <Empty>No agency owes you anything.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Agency</th><th className="num">Due</th><th className="num">Overdue</th><th>Oldest due</th><th className="num">Credit limit</th><th className="num">Available</th></tr></thead>
            <tbody>{pending.data.items.map((item) => (
              <tr key={item.packager_id}>
                <td><AgencyLink id={item.packager_id} name={item.name} />
                  <div className="muted small">{item.booking_count} booking{item.booking_count === 1 ? '' : 's'}{item.phone ? ` · ${item.phone}` : ''}</div></td>
                <td className="num"><Due paise={item.net_due_paise} />
                  {item.advance_credit_paise > 0 && <div className="muted small">{formatRupees(item.advance_credit_paise)} advance</div>}</td>
                <td className="num">{item.overdue_paise > 0 ? <Due paise={item.overdue_paise} /> : '—'}</td>
                <td className="nowrap">{item.oldest_due_date ? formatDate(item.oldest_due_date) : '—'}</td>
                <td className="num">{item.credit_limit_paise === null ? 'No limit' : formatRupees(item.credit_limit_paise)}</td>
                <td className="num">{item.available_credit_paise === null ? '—' : item.over_limit
                  ? <span className="badge danger">Over by {formatRupees(-item.available_credit_paise)}</span>
                  : formatRupees(item.available_credit_paise)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
