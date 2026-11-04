import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { formatDate, formatRupees } from '../money';
import { AgencyLink, Due, Empty, Field, Loading, Notice, PageHeader, Panel, Route, useApi, usePackagers } from '../ui';

type Row = { id: string; packager_id: string; packager_name: string; boarding_station: string; destination_station: string;
  train_identifier: string; journey_date: string; total_payable_paise: number; collected_paise: number;
  balance_due_paise: number; advance_credit_paise: number };

export function Bookings() {
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const packagers = usePackagers();
  const agency = params.get('packager_id') ?? '';
  const report = useApi<{ items: Row[]; next_offset: number | null }>(
    `/reports/bookings?limit=30&offset=${offset}${agency ? `&packager_id=${agency}` : ''}`);
  return (
    <>
      <PageHeader title="Bookings" subtitle="Newest first"
        action={<Link className="button primary" to="/bookings/new"><Plus aria-hidden="true" size={16} /> New booking</Link>} />
      <Panel>
        <div className="filters">
          <Field label="Agency"><select value={agency} onChange={(event) => {
            setParams(event.target.value ? { packager_id: event.target.value } : {}, { replace: true }); setOffset(0);
          }}>
            <option value="">All</option>
            {packagers.map((packager) => <option key={packager.id} value={packager.id}>{packager.name}</option>)}
          </select></Field>
        </div>
        <Notice error={report.error} />
        {report.loading ? <Loading /> : !report.data?.items.length ? <Empty>No bookings yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Agency</th><th>Date</th><th className="num">Payable</th><th className="num">Collected</th><th className="num">Due</th></tr></thead>
            <tbody>{report.data.items.map((row) => (
              <tr key={row.id}>
                <td><Link to={`/bookings/${row.id}`}><Route from={row.boarding_station} to={row.destination_station} /></Link>
                  <div className="muted small">Train {row.train_identifier}</div></td>
                <td><AgencyLink id={row.packager_id} name={row.packager_name} /></td>
                <td className="nowrap">{formatDate(row.journey_date)}</td>
                <td className="num">{formatRupees(row.total_payable_paise)}</td>
                <td className="num">{formatRupees(row.collected_paise)}</td>
                <td className="num"><Due paise={row.balance_due_paise} />
                  {row.advance_credit_paise > 0 && <div className="muted small">{formatRupees(row.advance_credit_paise)} credit</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="row pager">
          {offset > 0 && <button className="ghost" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button>}
          {report.data?.next_offset != null && <button className="ghost" onClick={() => setOffset(report.data!.next_offset!)}>Next</button>}
        </div>
      </Panel>
    </>
  );
}
