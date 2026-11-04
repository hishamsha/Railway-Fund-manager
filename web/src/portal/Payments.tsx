import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatRupees } from '../money';
import { Empty, Loading, Notice, PageHeader, Panel, Route, useApi } from '../ui';
import type { PortalPayment } from './types';

const labels: Record<string, string> = { receipt: 'Payment', refund: 'Refund to you', reversal: 'Payment reversed',
  collection_adjustment_increase: 'Correction', collection_adjustment_decrease: 'Correction' };

export function PortalPayments() {
  const [offset, setOffset] = useState(0);
  const payments = useApi<{ items: PortalPayment[]; next_offset: number | null }>(`/portal/payments?limit=30&offset=${offset}`);
  return (
    <>
      <PageHeader title="Payments" subtitle="Money recorded against your bookings, newest first" />
      <Panel>
        <Notice error={payments.error} />
        {payments.loading ? <Loading /> : !payments.data?.items.length ? <Empty>No payments recorded yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>What</th><th>Booking</th><th>Method</th><th className="num">Amount</th></tr></thead>
            <tbody>{payments.data.items.map((payment) => (
              <tr key={payment.id}>
                <td className="nowrap">{new Date(payment.occurred_at).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })}</td>
                <td>{labels[payment.entry_type] ?? 'Adjustment'}</td>
                <td><Link to={`/bookings/${payment.booking_id}`}><Route from={payment.boarding_station} to={payment.destination_station} /></Link>
                  <div className="muted small">{formatDate(payment.journey_date)}</div></td>
                <td>{payment.method?.toUpperCase() ?? '—'}</td>
                <td className={`num ${payment.amount_paise < 0 ? 'danger-text' : ''}`}>{formatRupees(payment.amount_paise)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="row pager">
          {offset > 0 && <button className="ghost" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button>}
          {payments.data?.next_offset != null && <button className="ghost" onClick={() => setOffset(payments.data!.next_offset!)}>Next</button>}
        </div>
      </Panel>
    </>
  );
}
