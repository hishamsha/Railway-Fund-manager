import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ticketStatuses, type BookingAccount, type TrackedLeg } from '../api';
import { formatDate, formatRupees } from '../money';
import { AgencyLink, Empty, Field, Loading, Notice, PageHeader, Panel, Route, StatusSelect, statusLabel, useAction, useApi,
  usePackagers } from '../ui';

function TicketRow({ leg, accounts, onSaved }: { leg: TrackedLeg; accounts: BookingAccount[]; onSaved: () => void }) {
  const [pnr, setPnr] = useState(leg.pnr ?? '');
  const { busy, error, setError, run } = useAction();
  const route = `${leg.boarding_station} to ${leg.destination_station}`;
  const save = (body: object) => run(async () => {
    await api(`/bookings/${leg.booking_id}/legs/${leg.id}`, { method: 'PATCH', body });
    onSaved();
  });
  const savePnr = () => {
    const next = pnr.trim();
    if (next === (leg.pnr ?? '')) return;
    void save({ pnr: next || null }).then((saved) => { if (!saved) setPnr(leg.pnr ?? ''); });
  };
  // An archived account is still shown on the tickets it bought.
  const known = accounts.some((account) => account.id === leg.booking_account_id);
  return (
    <>
      <tr>
        <td className="nowrap">{formatDate(leg.journey_date)}</td>
        <td><Link to={`/bookings/${leg.booking_id}`}><Route from={leg.boarding_station} to={leg.destination_station} /></Link>
          <div className="muted small">Train {leg.train_identifier}{leg.ticket_type === 'connected' ? ` · Leg ${leg.sequence}` : ''}</div></td>
        <td><AgencyLink id={leg.packager_id} name={leg.packager_name} /></td>
        <td className="num">{formatRupees(leg.fare_paise)}</td>
        <td><select aria-label={`Booked from, ${route}`} disabled={busy} value={leg.booking_account_id ?? ''}
          onChange={(event) => void save({ booking_account_id: event.target.value || null })}>
          <option value="">Not set</option>
          {!known && leg.booking_account_id && <option value={leg.booking_account_id}>Archived account</option>}
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></td>
        <td><input className="pnr" aria-label={`PNR, ${route}`} value={pnr} disabled={busy} placeholder="Add PNR"
          onChange={(event) => { setPnr(event.target.value); setError(null); }} onBlur={savePnr}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></td>
        <td><StatusSelect label={`Status, ${route}`} value={leg.ticket_status} disabled={busy}
          onChange={(status) => void save({ ticket_status: status })} /></td>
      </tr>
      {error && <tr><td colSpan={7}><Notice error={error} /></td></tr>}
    </>
  );
}

export function Tickets() {
  const [params, setParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const packagers = usePackagers();
  const accounts = useApi<{ items: BookingAccount[] }>('/booking-accounts');
  const query = new URLSearchParams(params);
  query.set('limit', '50');
  query.set('offset', String(offset));
  const tickets = useApi<{ items: TrackedLeg[]; next_offset: number | null }>(`/tickets?${query.toString()}`);
  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    setParams(next, { replace: true });
    setOffset(0);
  };
  return (
    <>
      <PageHeader title="Ticket tracker" subtitle="Change a status, PNR or source account here. It saves straight away." />
      <Panel>
        <div className="filters">
          <Field label="Status"><select value={params.get('status') ?? ''} onChange={(event) => filter('status', event.target.value)}>
            <option value="">All</option>
            {ticketStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select></Field>
          <Field label="Agency"><select value={params.get('packager_id') ?? ''} onChange={(event) => filter('packager_id', event.target.value)}>
            <option value="">All</option>
            {packagers.map((packager) => <option key={packager.id} value={packager.id}>{packager.name}</option>)}
          </select></Field>
          <Field label="Booked from"><select value={params.get('booking_account_id') ?? ''} onChange={(event) => filter('booking_account_id', event.target.value)}>
            <option value="">All</option>
            {accounts.data?.items.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select></Field>
          <Field label="From"><input type="date" value={params.get('from_date') ?? ''} onChange={(event) => filter('from_date', event.target.value)} /></Field>
          <Field label="To"><input type="date" value={params.get('to_date') ?? ''} onChange={(event) => filter('to_date', event.target.value)} /></Field>
        </div>
        <Notice error={tickets.error} />
        {tickets.loading ? <Loading /> : !tickets.data?.items.length ? <Empty>No tickets match these filters.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Journey</th><th>Agency</th><th className="num">Fare</th><th>Booked from</th><th>PNR</th><th>Status</th></tr></thead>
            <tbody>{tickets.data.items.map((leg) => (
              <TicketRow key={`${leg.id}-${leg.pnr ?? ''}`} leg={leg} accounts={accounts.data?.items ?? []} onSaved={tickets.reload} />
            ))}</tbody>
          </table></div>
        )}
        <div className="row pager">
          {offset > 0 && <button className="ghost" onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>}
          {tickets.data?.next_offset != null && <button className="ghost" onClick={() => setOffset(tickets.data!.next_offset!)}>Next</button>}
        </div>
      </Panel>
    </>
  );
}
