import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { api, createKeyHolder, type BookingAccount, type Leg, type Packager } from '../api';
import { formatDate, formatRupees, paiseToInput, parseRupees } from '../money';
import { AgencyLink, Due, Empty, Field, Loading, Notice, PageHeader, Panel, Route, Stat, StatusBadge, useAction, useApi } from '../ui';

type Booking = { id: string; packager_id: string; boarding_station: string; destination_station: string; journey_date: string;
  booking_person_mobile: string | null; notes: string | null; ticket_type: string; payment_due_date: string | null; legs: Leg[] };
type Financials = { ticket_price_paise: number; service_charge_paise: number; total_payable_paise: number; collected_paise: number;
  wallet_deducted_paise: number; fund_balance_paise: number; balance_due_paise: number; advance_credit_paise: number };
type Entry = { id: string; source: string; entry_type: string; amount_paise: number; method: string | null;
  original_entry_id: string | null; occurred_at: string; note: string | null };

const entryLabels: Record<string, string> = { receipt: 'Payment received', refund: 'Refund to agency', reversal: 'Payment reversed',
  collection_adjustment_increase: 'Collected total corrected up', collection_adjustment_decrease: 'Collected total corrected down',
  booking_debit: 'Wallet deduction', deduction_adjustment_decrease: 'Wallet deduction corrected down', wallet_refund: 'Wallet refund',
  debit_reversal: 'Wallet deduction reversed' };
const negativeEntries = ['refund', 'reversal', 'collection_adjustment_decrease', 'deduction_adjustment_decrease', 'wallet_refund', 'debit_reversal'];

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
          ...(withMethod ? { method } : {}), occurred_at: keys.stamp(), note: note.trim() || null } });
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

/** Refund gives back part or all of a payment. Reverse cancels what is left of one recorded by mistake. */
function CorrectPayment({ bookingId, entry, remaining, mode, onDone, onCancel }: { bookingId: string; entry: Entry; remaining: number;
  mode: 'refund' | 'reverse'; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(paiseToInput(remaining));
  const [method, setMethod] = useState(entry.method ?? 'upi');
  const [reason, setReason] = useState('');
  const [keys] = useState(createKeyHolder);
  const { busy, error, setError, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const paise = parseRupees(amount);
    if (mode === 'refund' && (!paise || paise > remaining)) {
      setError(new Error(`Enter an amount above zero and no more than ${formatRupees(remaining)}.`)); return;
    }
    void run(async () => {
      try {
        if (mode === 'refund') {
          await api(`/bookings/${bookingId}/customer-refunds`, { method: 'POST', idempotencyKey: keys.current(), body: {
            original_receipt_id: entry.id, amount_paise: paise, method, occurred_at: keys.stamp(), reason: reason.trim() } });
        } else {
          await api(`/finance/${entry.id}/reverse`, { method: 'POST', idempotencyKey: keys.current(),
            body: { occurred_at: keys.stamp(), reason: reason.trim() } });
        }
        keys.settle();
      } catch (failure) { keys.settle(failure); throw failure; }
      onDone();
    });
  };
  return (
    <form className="correction" onSubmit={submit}>
      <h3>{mode === 'refund' ? 'Refund this payment' : `Reverse ${formatRupees(remaining)} of this payment`}</h3>
      <p className="muted small">{mode === 'refund'
        ? 'Use this when you gave money back to the agency. What they owe on this booking goes up by this amount.'
        : 'Use this when the payment was recorded by mistake or never arrived, such as a bounced transfer. What they owe goes up by this amount.'} This can't be undone.</p>
      <div className="form-grid">
        {mode === 'refund' && <Field label="Amount (₹)" hint={`Up to ${formatRupees(remaining)}`}><input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>}
        {mode === 'refund' && <Field label="Method"><select value={method} onChange={(event) => setMethod(event.target.value)}>
          <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="other">Other</option>
        </select></Field>}
        <Field label="Reason (required)"><input required minLength={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </div>
      <Notice error={error} />
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : mode === 'refund' ? 'Save refund' : 'Reverse payment'}</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const detail = useApi<{ booking: Booking; financials: Financials }>(`/bookings/${id}`);
  const entries = useApi<{ items: Entry[] }>(`/bookings/${id}/entries?limit=100`);
  const accounts = useApi<{ items: BookingAccount[] }>('/booking-accounts?include_inactive=true');
  const booking = detail.data?.booking;
  const packager = useApi<{ packager: Packager }>(booking ? `/packagers/${booking.packager_id}` : null);
  const [correcting, setCorrecting] = useState<{ id: string; mode: 'refund' | 'reverse' } | null>(null);
  if (detail.error) return <Notice error={detail.error} />;
  if (!booking || !detail.data) return <Loading />;
  const money = detail.data.financials;
  const refresh = () => { detail.reload(); entries.reload(); };
  const accountName = (accountId: string | null) => accounts.data?.items.find((account) => account.id === accountId)?.name ?? '—';
  const items = entries.data?.items ?? [];
  const remainingOf = (entry: Entry) => entry.amount_paise - items
    .filter((other) => other.original_entry_id === entry.id)
    .reduce((total, other) => total + other.amount_paise, 0);
  const hasCancelled = booking.legs.some((leg) => leg.ticket_status === 'cancelled');
  return (
    <>
      <PageHeader title={`${booking.boarding_station} → ${booking.destination_station}`}
        subtitle={`${formatDate(booking.journey_date)} · ${booking.ticket_type === 'connected' ? 'Connected' : 'Direct'} ticket${booking.booking_person_mobile ? ` · ${booking.booking_person_mobile}` : ''}`}
        action={<Link className="button ghost" to={`/bookings/${id}/edit`}><Pencil aria-hidden="true" size={16} /> Edit booking</Link>} />
      {hasCancelled && (
        <div className="notice info" role="status">
          A cancelled ticket no longer counts toward what the agency owes, except any cancellation charge. The service charge stays until you edit it.
          {money.advance_credit_paise > 0 && ` The agency now has ${formatRupees(money.advance_credit_paise)} in credit on this booking; refund it from History if you're paying it back.`}
          {money.wallet_deducted_paise > 0 && ' If you got money back for this ticket, correct the wallet deduction in Edit booking.'}
        </div>
      )}
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
          <div><dt>Tickets billed</dt><dd>{formatRupees(money.ticket_price_paise)}</dd></div>
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
              <td className="num">{leg.ticket_status === 'cancelled' ? <>
                <s>{formatRupees(leg.fare_paise)}</s>
                <div className="muted small">{leg.cancellation_charge_paise > 0 ? `${formatRupees(leg.cancellation_charge_paise)} charge` : 'No charge'}</div>
              </> : formatRupees(leg.fare_paise)}</td>
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
        {!items.length ? <Empty>No money recorded yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>What</th><th>Method</th><th>Note or reason</th><th className="num">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{items.map((entry) => {
              const remaining = entry.source === 'customer' && entry.entry_type === 'receipt' ? remainingOf(entry) : 0;
              const open = correcting?.id === entry.id ? correcting.mode : null;
              return (
                <HistoryRow key={`${entry.source}-${entry.id}`} entry={entry} remaining={remaining} open={open}
                  onOpen={(mode) => setCorrecting({ id: entry.id, mode })}
                  panel={open && <CorrectPayment bookingId={booking.id} entry={entry} remaining={remaining} mode={open}
                    onCancel={() => setCorrecting(null)} onDone={() => { setCorrecting(null); refresh(); }} />} />
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

function HistoryRow({ entry, remaining, open, onOpen, panel }: { entry: Entry; remaining: number; open: string | null;
  onOpen: (mode: 'refund' | 'reverse') => void; panel: ReactNode }) {
  const negative = negativeEntries.includes(entry.entry_type);
  const isReceipt = entry.source === 'customer' && entry.entry_type === 'receipt';
  return (
    <>
      <tr>
        <td className="nowrap">{new Date(entry.occurred_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</td>
        <td>{entryLabels[entry.entry_type] ?? entry.entry_type.replaceAll('_', ' ')}
          {isReceipt && remaining < entry.amount_paise && <div className="muted small">{remaining > 0 ? `${formatRupees(remaining)} left to refund` : 'Fully refunded or reversed'}</div>}</td>
        <td>{entry.method?.toUpperCase() ?? '—'}</td>
        <td>{entry.note ?? '—'}</td>
        <td className={`num ${negative ? 'danger-text' : ''}`}>{formatRupees(negative ? -entry.amount_paise : entry.amount_paise)}</td>
        <td>{remaining > 0 && !open && <div className="row nowrap-row">
          <button className="ghost" onClick={() => onOpen('refund')}>Refund</button>
          <button className="ghost" onClick={() => onOpen('reverse')}>Reverse</button>
        </div>}</td>
      </tr>
      {panel && <tr><td colSpan={6}>{panel}</td></tr>}
    </>
  );
}
