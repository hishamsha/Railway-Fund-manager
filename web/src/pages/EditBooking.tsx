import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiFailure, api, createKeyHolder, type BookingAccount, type Leg, type Packager } from '../api';
import { formatRupees, paiseToInput, parseRupees } from '../money';
import { Field, Loading, Notice, PageHeader, Panel, useAction, useApi } from '../ui';
import { LegFields, legToForm, legsBilled, legsToBody, legsValid, type LegForm } from './LegFields';

type Booking = { id: string; packager_id: string; booking_person_mobile: string | null; notes: string | null;
  payment_due_date: string | null; updated_at: string; legs: Leg[] };
type Financials = { service_charge_paise: number; total_payable_paise: number; collected_paise: number; wallet_deducted_paise: number };
type Pending = { items: Array<{ packager_id: string; net_due_paise: number; advance_credit_paise: number; credit_limit_paise: number | null }> };

export function EditBooking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const detail = useApi<{ booking: Booking; financials: Financials }>(`/bookings/${id}`);
  const accounts = useApi<{ items: BookingAccount[] }>('/booking-accounts?include_inactive=true');
  const pending = useApi<Pending>('/finance/pending-agencies?include_settled=true');
  const booking = detail.data?.booking;
  const money = detail.data?.financials;
  const packager = useApi<{ packager: Packager }>(booking ? `/packagers/${booking.packager_id}` : null);
  const [keys] = useState(createKeyHolder);
  const [legs, setLegs] = useState<LegForm[]>([]);
  const [charge, setCharge] = useState('');
  const [collected, setCollected] = useState('');
  const [deducted, setDeducted] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [mobile, setMobile] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useAction();

  // Fill the form once. The saved values stay in `detail` for the stale-edit check.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (filled || !booking || !money) return;
    setLegs(booking.legs.map(legToForm));
    setCharge(paiseToInput(money.service_charge_paise));
    setCollected(paiseToInput(money.collected_paise));
    setDeducted(paiseToInput(money.wallet_deducted_paise));
    setDueDate(booking.payment_due_date ?? '');
    setMobile(booking.booking_person_mobile ?? '');
    setNotes(booking.notes ?? '');
    setFilled(true);
  }, [filled, booking, money]);

  if (detail.error) return <Notice error={detail.error} />;
  if (!booking || !money || !filled) return <Loading />;

  const chargePaise = parseRupees(charge);
  const collectedPaise = parseRupees(collected);
  const deductedPaise = parseRupees(deducted);
  const valid = legsValid(legs) && chargePaise !== null && collectedPaise !== null && deductedPaise !== null;
  const newPayable = legsBilled(legs) + (chargePaise ?? 0);
  const balance = newPayable - (collectedPaise ?? 0);
  const moneyCorrected = collectedPaise !== money.collected_paise || deductedPaise !== money.wallet_deducted_paise;

  // The API does not check the credit limit on edits, so warn here.
  const agency = pending.data?.items.find((item) => item.packager_id === booking.packager_id);
  const newNetDue = agency ? agency.net_due_paise - agency.advance_credit_paise
    + (newPayable - money.total_payable_paise) - ((collectedPaise ?? 0) - money.collected_paise) : 0;
  const overLimit = agency?.credit_limit_paise != null && valid && newNetDue > agency.credit_limit_paise
    && newNetDue > agency.net_due_paise - agency.advance_credit_paise;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) { setError(new Error('Enter amounts in rupees, such as 1250 or 1250.50. Each fare must be more than zero.')); return; }
    if (moneyCorrected && !reason.trim()) { setError(new Error('Explain why the collected or wallet total changed.')); return; }
    void run(async () => {
      try {
        await api(`/bookings/${id}`, { method: 'PATCH', idempotencyKey: keys.current(), body: {
          packager_id: booking.packager_id,
          legs: legsToBody(legs),
          booking_person_mobile: mobile.trim() || null,
          payment_due_date: dueDate || null,
          service_charge_paise: chargePaise,
          collected_paise: collectedPaise,
          wallet_deducted_paise: deductedPaise,
          notes: notes.trim() || null,
          expected_updated_at: booking.updated_at,
          expected_collected_paise: money.collected_paise,
          expected_wallet_deducted_paise: money.wallet_deducted_paise,
          correction_reason: reason.trim() || null,
        } });
        keys.settle();
      } catch (failure) { keys.settle(failure); throw failure; }
      navigate(`/bookings/${id}`);
    });
  };
  const stale = error instanceof ApiFailure && error.code === 'EDIT_CONFLICT';

  return (
    <>
      <PageHeader title="Edit booking" subtitle={packager.data?.packager.name} />
      <form onSubmit={submit}>
        <LegFields legs={legs} onChange={setLegs} accounts={accounts.data?.items ?? []} />
        <Panel title="Charges and details">
          <div className="form-grid">
            <Field label="Service charge (₹)"><input required inputMode="decimal" value={charge} onChange={(event) => setCharge(event.target.value)} /></Field>
            <Field label="Payment due date" hint="Leave blank to use the journey date."><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
            <Field label="Passenger mobile (optional)"><input type="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} /></Field>
          </div>
          <Field label="Notes (private)"><textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </Panel>
        <Panel title="Correct the money totals">
          <p className="muted">Only change these to fix a mistake in what was recorded. If you gave money back, use Refund in the booking's history instead.</p>
          <div className="form-grid">
            <Field label="Total collected (₹)"><input required inputMode="decimal" value={collected} onChange={(event) => setCollected(event.target.value)} /></Field>
            <Field label="Total wallet deduction (₹)"><input required inputMode="decimal" value={deducted} onChange={(event) => setDeducted(event.target.value)} /></Field>
            <Field label={moneyCorrected ? 'Reason for this correction (required)' : 'Reason for this edit (optional)'}>
              <input required={moneyCorrected} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          </div>
          <p className="total">New total payable <strong>{formatRupees(newPayable)}</strong> · {balance < 0 ? 'Advance credit' : 'Balance due'} <strong>{formatRupees(Math.abs(balance))}</strong></p>
        </Panel>
        {overLimit && <div className="notice warn" role="status">This takes the agency's due to {formatRupees(newNetDue)}, above its {formatRupees(agency!.credit_limit_paise!)} credit limit. You can still save it.</div>}
        <Notice error={error} />
        {stale && <button type="button" className="ghost form-reload" onClick={() => window.location.reload()}>Reload the latest version</button>}
        <div className="row form-actions">
          <button className="primary" disabled={busy || stale}>{busy ? 'Saving…' : 'Save changes'}</button>
          <Link className="button ghost" to={`/bookings/${id}`}>Cancel</Link>
        </div>
      </form>
    </>
  );
}
