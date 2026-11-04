import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api, createKeyHolder, type BookingAccount, type Leg, type Packager } from '../api';
import { formatDate, formatRupees, parseRupees } from '../money';
import { AgencyLink, Due, Empty, Field, Loading, Notice, PageHeader, Panel, Route, Stat, StatusBadge, useAction, useApi } from '../ui';

type Booking = { id: string; packager_id: string; boarding_station: string; destination_station: string; journey_date: string;
  booking_person_mobile: string | null; notes: string | null; ticket_type: string; payment_due_date: string | null; legs: Leg[] };
type Financials = { ticket_price_paise: number; service_charge_paise: number; total_payable_paise: number; collected_paise: number;
  wallet_deducted_paise: number; fund_balance_paise: number; balance_due_paise: number; advance_credit_paise: number };
type Entry = { id: string; source: string; entry_type: string; amount_paise: number; method: string | null;
  occurred_at: string; note: string | null };

const entryLabels: Record<string, string> = { receipt: 'Payment received', refund: 'Refund', reversal: 'Payment reversed',
  collection_adjustment_increase: 'Collection corrected up', collection_adjustment_decrease: 'Collection corrected down',
  booking_debit: 'Wallet deduction', deduction_adjustment_decrease: 'Deduction corrected down', wallet_refund: 'Wallet refund',
  debit_reversal: 'Deduction reversed' };

function MoneyForm({ title, label, path, withMethod, onSaved }: { title: string; label: string; path: string; withMethod?: boolean; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('upi');
  const [note, setNote] = useState('');
  const [keys] = useState(createKeyHolder);
  const { busy, error, setError, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const paise = parseRupees(amount);
    if (!paise) { setError(new Error('Enter an amount in rupees, such as 1250 or 1250.50.')); return; }
    void run(async () => {
      try {
        await api(path, { method: 'POST', idempotencyKey: keys.current(), body: { amount_paise: paise,
          ...(withMethod ? { method } : {}), occurred_at: new Date().toISOString(), note: note.trim() || null } });
        keys.settle();
      } catch (failure) { keys.settle(failure); throw failure; }
      setAmount(''); setNote('');
      onSaved();
    });
  };
  return (
    <Panel title={title}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={label}><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          {withMethod && <Field label="Method"><select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option>
          </select></Field>}
          <Field label="Note (private)"><input maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        </div>
        <Notice error={error} />
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Panel>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const detail = useApi<{ booking: Booking; financials: Financials }>(`/bookings/${id}`);
  const entries = useApi<{ items: Entry[] }>(`/bookings/${id}/entries?limit=100`);
  const accounts = useApi<{ items: BookingAccount[] }>('/booking-accounts?include_inactive=true');
  const booking = detail.data?.booking;
  const packager = useApi<{ packager: Packager }>(booking ? `/packagers/${booking.packager_id}` : null);
  if (detail.error) return <Notice error={detail.error} />;
  if (!booking || !detail.data) return <Loading />;
  const money = detail.data.financials;
  const refresh = () => { detail.reload(); entries.reload(); };
  const accountName = (accountId: string | null) => accounts.data?.items.find((account) => account.id === accountId)?.name ?? '—';
  return (
    <>
      <PageHeader title={`${booking.boarding_station} → ${booking.destination_station}`}
        subtitle={`${formatDate(booking.journey_date)} · ${booking.ticket_type === 'connected' ? 'Connected' : 'Direct'} ticket${booking.booking_person_mobile ? ` · ${booking.booking_person_mobile}` : ''}`} />
      <div className="stats">
        <Stat label="Total payable" value={formatRupees(money.total_payable_paise)} />
        <Stat label="Collected" value={formatRupees(money.collected_paise)} />
        <Stat label={money.advance_credit_paise > 0 ? 'Advance credit' : 'Balance due'}
          value={formatRupees(money.advance_credit_paise || money.balance_due_paise)}
          tone={money.balance_due_paise > 0 ? 'danger' : 'good'} />
        <Stat label="Ticket price minus wallet" value={formatRupees(money.fund_balance_paise)} />
      </div>
      <Panel title="Details">
        <dl className="details">
          <div><dt>Agency</dt><dd>{packager.data ? <AgencyLink id={booking.packager_id} name={packager.data.packager.name} /> : '…'}</dd></div>
          <div><dt>Ticket price</dt><dd>{formatRupees(money.ticket_price_paise)}</dd></div>
          <div><dt>Service charge</dt><dd>{formatRupees(money.service_charge_paise)}</dd></div>
          <div><dt>Wallet deducted</dt><dd>{formatRupees(money.wallet_deducted_paise)}</dd></div>
          <div><dt>Payment due</dt><dd>{formatDate(booking.payment_due_date ?? booking.journey_date)} {money.balance_due_paise > 0 && <Due paise={money.balance_due_paise} />}</dd></div>
          {booking.notes && <div><dt>Notes</dt><dd>{booking.notes}</dd></div>}
        </dl>
      </Panel>
      <Panel title="Tickets">
        <div className="table-wrap"><table>
          <thead><tr><th>Leg</th><th>Journey</th><th>Date</th><th>Train</th><th className="num">Fare</th><th>Booked from</th><th>PNR</th><th>Status</th></tr></thead>
          <tbody>{booking.legs.map((leg) => (
            <tr key={leg.id}>
              <td>{leg.sequence}</td>
              <td><Route from={leg.boarding_station} to={leg.destination_station} /></td>
              <td className="nowrap">{formatDate(leg.journey_date)}</td>
              <td>{leg.train_identifier}</td>
              <td className="num">{formatRupees(leg.fare_paise)}</td>
              <td>{accountName(leg.booking_account_id)}</td>
              <td>{leg.pnr ?? '—'}</td>
              <td><StatusBadge status={leg.ticket_status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <div className="two-col">
        <MoneyForm title="Record a payment" label="Amount received (₹)" path={`/bookings/${id}/collections`} withMethod onSaved={refresh} />
        <MoneyForm title="Record a wallet deduction" label="Amount deducted (₹)" path={`/bookings/${id}/deductions`} onSaved={refresh} />
      </div>
      <Panel title="History">
        {!entries.data?.items.length ? <Empty>No money recorded yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>What</th><th>Method</th><th>Note</th><th className="num">Amount</th></tr></thead>
            <tbody>{entries.data.items.map((entry) => (
              <tr key={`${entry.source}-${entry.id}`}>
                <td className="nowrap">{new Date(entry.occurred_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</td>
                <td>{entryLabels[entry.entry_type] ?? entry.entry_type.replaceAll('_', ' ')}</td>
                <td>{entry.method?.toUpperCase() ?? '—'}</td>
                <td>{entry.note ?? '—'}</td>
                <td className="num">{formatRupees(entry.amount_paise)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
