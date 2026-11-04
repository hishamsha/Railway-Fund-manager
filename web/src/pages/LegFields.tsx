import { Plus, Trash2 } from 'lucide-react';
import type { BookingAccount, Leg } from '../api';
import { billedPaise, paiseToInput, parseRupees } from '../money';
import { Field, Panel, StatusSelect } from '../ui';

export type LegForm = { from: string; to: string; date: string; train: string; fare: string; account: string; pnr: string;
  status: string; charge: string };

export const blankLeg = (date: string, from = ''): LegForm =>
  ({ from, to: '', date, train: '', fare: '', account: '', pnr: '', status: 'booked', charge: '' });

export function legToForm(leg: Leg): LegForm {
  return { from: leg.boarding_station, to: leg.destination_station, date: leg.journey_date, train: leg.train_identifier,
    fare: paiseToInput(leg.fare_paise), account: leg.booking_account_id ?? '', pnr: leg.pnr ?? '', status: leg.ticket_status,
    charge: leg.cancellation_charge_paise ? paiseToInput(leg.cancellation_charge_paise) : '' };
}

/** A cancelled ticket's charge in paise; blank means none, null means not a valid amount. */
function legCharge(leg: LegForm): number | null {
  return leg.status !== 'cancelled' || !leg.charge.trim() ? 0 : parseRupees(leg.charge);
}

/** True when every fare is above zero and every cancellation charge is a valid amount. */
export function legsValid(legs: LegForm[]): boolean {
  return legs.every((leg) => Boolean(parseRupees(leg.fare)) && legCharge(leg) !== null);
}

/** What these tickets bill together, as the API will work it out. */
export function legsBilled(legs: LegForm[]): number {
  return legs.reduce((total, leg) => total + billedPaise(leg.status, parseRupees(leg.fare) ?? 0, legCharge(leg) ?? 0), 0);
}

export function legsToBody(legs: LegForm[]) {
  return legs.map((leg) => ({ boarding_station: leg.from, destination_station: leg.to, journey_date: leg.date,
    train_identifier: leg.train, fare_paise: parseRupees(leg.fare), booking_account_id: leg.account || null,
    pnr: leg.pnr.trim() || null, ticket_status: leg.status, cancellation_charge_paise: legCharge(leg) ?? 0 }));
}

export function LegFields({ legs, onChange, accounts }: { legs: LegForm[]; onChange: (legs: LegForm[]) => void; accounts: BookingAccount[] }) {
  const update = (index: number, change: Partial<LegForm>) =>
    onChange(legs.map((leg, position) => position === index ? { ...leg, ...change } : leg));
  return (
    <Panel title={legs.length > 1 ? `Connected ticket · ${legs.length} legs` : 'Direct ticket'} action={
      <button type="button" className="ghost" onClick={() => onChange([...legs, blankLeg(legs.at(-1)!.date, legs.at(-1)!.to)])}>
        <Plus aria-hidden="true" size={16} /> Add connecting leg
      </button>
    }>
      {legs.map((leg, index) => (
        <fieldset className="leg" key={index}>
          <legend>Leg {index + 1}</legend>
          <div className="form-grid">
            <Field label="From station"><input required maxLength={160} value={leg.from} onChange={(event) => update(index, { from: event.target.value })} /></Field>
            <Field label="To station"><input required maxLength={160} value={leg.to} onChange={(event) => update(index, { to: event.target.value })} /></Field>
            <Field label="Journey date"><input type="date" required value={leg.date} onChange={(event) => update(index, { date: event.target.value })} /></Field>
            <Field label="Train"><input required maxLength={160} value={leg.train} onChange={(event) => update(index, { train: event.target.value })} placeholder="12602" /></Field>
            <Field label="Fare (₹)"><input required inputMode="decimal" value={leg.fare} onChange={(event) => update(index, { fare: event.target.value })} /></Field>
            <Field label="Booked from"><select value={leg.account} onChange={(event) => update(index, { account: event.target.value })}>
              <option value="">Not set</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.is_active ? '' : ' (archived)'}</option>)}
            </select></Field>
            <Field label="PNR (optional)"><input value={leg.pnr} onChange={(event) => update(index, { pnr: event.target.value })} /></Field>
            <Field label="Status"><StatusSelect label={`Leg ${index + 1} status`} value={leg.status} onChange={(status) => update(index, { status })} /></Field>
            {leg.status === 'cancelled' && <Field label="Cancellation charge (₹)" hint="The fare no longer counts. Leave blank for no charge.">
              <input inputMode="decimal" value={leg.charge} onChange={(event) => update(index, { charge: event.target.value })} /></Field>}
          </div>
          {legs.length > 1 && <button type="button" className="ghost danger-text" onClick={() => onChange(legs.filter((_, position) => position !== index))}>
            <Trash2 aria-hidden="true" size={16} /> Remove leg {index + 1}</button>}
        </fieldset>
      ))}
    </Panel>
  );
}
