import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type JourneyRequest } from '../api';
import { formatDate, formatRupees, paiseToInput, parseRupees } from '../money';
import { AgencyLink, Empty, Field, Loading, Notice, PageHeader, Panel, Route, StatusBadge, statusLabel, useAction, useApi } from '../ui';

const tabs = ['pending', 'quoted', 'accepted', 'booked', 'declined', 'cancelled'];

function RequestCard({ request, onChanged }: { request: JourneyRequest; onChanged: () => void }) {
  const [price, setPrice] = useState(request.quote ? paiseToInput(request.quote.ticket_price_paise) : '');
  const [charge, setCharge] = useState(request.quote ? paiseToInput(request.quote.service_charge_paise) : '');
  const [note, setNote] = useState(request.quote?.note ?? '');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useAction();
  const open = ['pending', 'quoted', 'accepted'].includes(request.status);
  const canQuote = ['pending', 'quoted'].includes(request.status);
  const quote = (event: FormEvent) => {
    event.preventDefault();
    const pricePaise = parseRupees(price);
    const chargePaise = charge.trim() ? parseRupees(charge) : undefined;
    if (!pricePaise || chargePaise === null) { setError(new Error('Enter amounts in rupees, such as 1250 or 1250.50.')); return; }
    void run(async () => {
      await api(`/journey-requests/${request.id}/quote`, { method: 'POST', body: { ticket_price_paise: pricePaise,
        ...(chargePaise !== undefined ? { service_charge_paise: chargePaise } : {}), note: note.trim() || null } });
      onChanged();
    });
  };
  const decline = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api(`/journey-requests/${request.id}/decline`, { method: 'POST', body: { reason } });
      onChanged();
    });
  };
  return (
    <Panel>
      <div className="request-head">
        <div>
          <h2><Route from={request.boarding_station} to={request.destination_station} /></h2>
          <p className="muted">{formatDate(request.journey_date)} · {request.passenger_count} passenger{request.passenger_count === 1 ? '' : 's'} · {request.ticket_type === 'connected' ? 'Connected' : 'Direct'}{request.train_identifier ? ` · Train ${request.train_identifier}` : ''}</p>
          <p><AgencyLink id={request.packager_id} name={request.packager_name} /> <span className="muted small">· {request.requested_by.email}</span></p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      {request.agency_note && <div className="notice info">Agency note: {request.agency_note}</div>}
      {request.decline_reason && <div className="notice danger">Declined: {request.decline_reason}</div>}
      {request.quote && <p>Quoted <strong>{formatRupees(request.quote.total_paise)}</strong> <span className="muted small">({formatRupees(request.quote.ticket_price_paise)} ticket + {formatRupees(request.quote.service_charge_paise)} service charge)</span></p>}
      {request.booking_id && <p><Link to={`/bookings/${request.booking_id}`}>Open the booking</Link></p>}
      <Notice error={error} />
      {canQuote && (
        <form onSubmit={quote}>
          <div className="form-grid">
            <Field label="Ticket price (₹)"><input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
            <Field label="Service charge (₹)" hint="Leave blank to use your rule."><input inputMode="decimal" value={charge} onChange={(event) => setCharge(event.target.value)} /></Field>
            <Field label="Note" hint="The agency can see this."><input maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
          </div>
          <button className="primary" disabled={busy}>{request.quote ? 'Update quote' : 'Send quote'}</button>
        </form>
      )}
      {open && (
        <div className="row request-actions">
          <Link className={`button ${request.status === 'accepted' ? 'primary' : 'ghost'}`} to={`/bookings/new?request=${request.id}`}>Book this journey</Link>
          <button type="button" className="ghost" onClick={() => setDeclining(!declining)}>Decline</button>
        </div>
      )}
      {open && declining && (
        <form onSubmit={decline}>
          <Field label="Reason" hint="The agency can see this."><input required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <button className="ghost danger-text" disabled={busy}>Decline request</button>
        </form>
      )}
    </Panel>
  );
}

export function Requests({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState('pending');
  const requests = useApi<{ items: JourneyRequest[] }>(`/journey-requests?status=${status}&limit=100`);
  const changed = () => { requests.reload(); onChanged(); };
  return (
    <>
      <PageHeader title="Requests" subtitle="Journeys agencies have asked for" />
      <div className="tabs" role="group" aria-label="Filter by status">
        {tabs.map((tab) => <button key={tab} aria-pressed={status === tab} className={status === tab ? 'tab active' : 'tab'} onClick={() => setStatus(tab)}>{statusLabel(tab)}</button>)}
      </div>
      <Notice error={requests.error} />
      {requests.loading ? <Loading /> : !requests.data?.items.length ? <Panel><Empty>No {status} requests.</Empty></Panel>
        : requests.data.items.map((request) => <RequestCard key={`${request.id}-${request.status}`} request={request} onChanged={changed} />)}
    </>
  );
}
