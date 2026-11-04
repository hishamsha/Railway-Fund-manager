import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiFailure, api, createKeyHolder, type BookingAccount, type JourneyRequest } from '../api';
import { formatRupees, indiaToday, paiseToInput, parseRupees } from '../money';
import { Field, Notice, PageHeader, Panel, useAction, useApi, usePackagers } from '../ui';
import { LegFields, blankLeg, legFares, legsToBody, type LegForm } from './LegFields';

export function NewBooking({ onBooked }: { onBooked: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const request = useApi<{ journey_request: JourneyRequest }>(requestId ? `/journey-requests/${requestId}` : null);
  const packagers = usePackagers();
  const accounts = useApi<{ items: BookingAccount[] }>('/booking-accounts');
  const [keys] = useState(createKeyHolder);
  const [packagerId, setPackagerId] = useState(params.get('packager_id') ?? '');
  const [legs, setLegs] = useState<LegForm[]>([blankLeg(indiaToday())]);
  const [charge, setCharge] = useState('');
  const [collected, setCollected] = useState('');
  const [deducted, setDeducted] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [mobile, setMobile] = useState('');
  const [notes, setNotes] = useState('');
  const [overLimit, setOverLimit] = useState(false);
  const { busy, error, setError, run } = useAction();

  const journey = request.data?.journey_request;
  useEffect(() => {
    if (!journey) return;
    setPackagerId(journey.packager_id);
    setLegs([{ ...blankLeg(journey.journey_date, journey.boarding_station), to: journey.destination_station,
      train: journey.train_identifier ?? '', fare: journey.quote ? paiseToInput(journey.quote.ticket_price_paise) : '' }]);
    if (journey.quote) setCharge(paiseToInput(journey.quote.service_charge_paise));
  }, [journey]);

  const ticketType = legs.length > 1 ? 'connected' : 'direct';
  const quote = useApi<{ charge_paise: number; source: string }>(packagerId
    ? `/service-charge-rules/quote?packager_id=${packagerId}&ticket_type=${ticketType}` : null);
  const fares = legFares(legs);
  const fareTotal = fares.reduce<number>((total, fare) => total + (fare ?? 0), 0);
  const chargePaise = charge.trim() ? parseRupees(charge) : quote.data?.charge_paise ?? 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const money = [charge, collected, deducted].filter((text) => text.trim()).map(parseRupees);
    if (fares.some((fare) => !fare) || money.some((amount) => amount === null)) {
      setError(new Error('Enter amounts in rupees, such as 1250 or 1250.50. Each fare must be more than zero.'));
      return;
    }
    void run(async () => {
      try {
        const body = {
          packager_id: packagerId,
          legs: legsToBody(legs),
          ...(charge.trim() ? { service_charge_paise: parseRupees(charge) } : {}),
          initial_collected_paise: collected.trim() ? parseRupees(collected) : 0,
          wallet_deducted_paise: deducted.trim() ? parseRupees(deducted) : 0,
          payment_due_date: dueDate || null,
          booking_person_mobile: mobile.trim() || null,
          notes: notes.trim() || null,
          allow_over_credit_limit: overLimit,
          ...(requestId ? { journey_request_id: requestId } : {}),
        };
        const created = await api<{ booking: { id: string } }>('/bookings', { method: 'POST', body, idempotencyKey: keys.current() });
        keys.settle();
        onBooked();
        navigate(`/bookings/${created.booking.id}`);
      } catch (failure) {
        keys.settle(failure);
        throw failure;
      }
    });
  };
  const creditBlocked = error instanceof ApiFailure && error.code === 'CREDIT_LIMIT_EXCEEDED';

  return (
    <>
      <PageHeader title="New booking" subtitle={journey ? `For ${journey.packager_name}'s request · ${journey.passenger_count} passenger(s)` : undefined} />
      <Notice error={request.error} />
      {journey?.agency_note && <div className="notice info">Agency note: {journey.agency_note}</div>}
      <form onSubmit={submit}>
        <Panel title="Agency">
          <div className="form-grid">
            <Field label="Agency"><select required value={packagerId} disabled={Boolean(journey)} onChange={(event) => setPackagerId(event.target.value)}>
              <option value="">Choose an agency</option>
              {packagers.map((packager) => <option key={packager.id} value={packager.id}>{packager.name}</option>)}
            </select></Field>
            <Field label="Passenger mobile (optional)"><input type="tel" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="9876543210" /></Field>
          </div>
        </Panel>
        <LegFields legs={legs} onChange={setLegs} accounts={accounts.data?.items ?? []} />
        <Panel title="Money">
          <div className="form-grid">
            <Field label="Service charge (₹)" hint={charge.trim() ? 'Your amount replaces the rule.'
              : quote.data ? `Leave blank to use the rule: ${formatRupees(quote.data.charge_paise)}` : undefined}>
              <input inputMode="decimal" value={charge} onChange={(event) => setCharge(event.target.value)} />
            </Field>
            <Field label="Collected now (₹)"><input inputMode="decimal" value={collected} onChange={(event) => setCollected(event.target.value)} /></Field>
            <Field label="Wallet deduction (₹)" hint="What you paid for the ticket. Agencies never see this."><input inputMode="decimal" value={deducted} onChange={(event) => setDeducted(event.target.value)} /></Field>
            <Field label="Payment due date" hint="Leave blank to use the journey date."><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
          </div>
          <Field label="Notes (private)"><textarea rows={2} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <p className="total">Total payable <strong>{formatRupees(fareTotal + (chargePaise ?? 0))}</strong></p>
        </Panel>
        <Notice error={error} />
        {(creditBlocked || overLimit) && (
          <label className="check"><input type="checkbox" checked={overLimit} onChange={(event) => setOverLimit(event.target.checked)} />
            Book anyway, over this agency's credit limit</label>
        )}
        <div className="row form-actions">
          <button className="primary" disabled={busy || (creditBlocked && !overLimit)}>{busy ? 'Saving…' : 'Save booking'}</button>
          <button type="button" className="ghost" onClick={() => navigate(-1)}>Cancel</button>
        </div>
      </form>
    </>
  );
}
