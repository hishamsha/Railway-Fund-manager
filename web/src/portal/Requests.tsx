import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { ApiFailure, api, createKeyHolder } from '../api';
import { formatDate, formatRupees, indiaToday } from '../money';
import { Empty, Field, Loading, Notice, PageHeader, Panel, Route, StatusBadge, useAction, useApi } from '../ui';
import type { PortalRequest } from './types';

function RequestCard({ request, onChanged, onQuoteChanged }: { request: PortalRequest; onChanged: () => void; onQuoteChanged: (message: string) => void }) {
  const { busy, error, run } = useAction();
  const open = ['pending', 'quoted', 'accepted'].includes(request.status);
  const accept = () => void run(async () => {
    try {
      await api(`/portal/journey-requests/${request.id}/accept`, { method: 'POST', body: { quoted_total_paise: request.quote!.total_paise } });
    } catch (failure) {
      // Reloading replaces this card, so the message has to live on the page.
      if (failure instanceof ApiFailure && ['QUOTE_CHANGED', 'REQUEST_STATE_CONFLICT'].includes(failure.code)) {
        onQuoteChanged(`This request changed, so ${formatRupees(request.quote!.total_paise)} was not accepted. Check the latest details below.`);
        onChanged();
        return;
      }
      throw failure;
    }
    onQuoteChanged('');
    onChanged();
  });
  const cancel = () => {
    if (!window.confirm('Cancel this request?')) return;
    void run(async () => {
      await api(`/portal/journey-requests/${request.id}/cancel`, { method: 'POST' });
      onChanged();
    });
  };
  return (
    <Panel>
      <div className="request-head">
        <div>
          <h2><Route from={request.boarding_station} to={request.destination_station} /></h2>
          <p className="muted">{formatDate(request.journey_date)} · {request.passenger_count} passenger{request.passenger_count === 1 ? '' : 's'} · {request.ticket_type === 'connected' ? 'Connected' : 'Direct'}{request.train_identifier ? ` · Train ${request.train_identifier}` : ''}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      {request.agency_note && <p className="muted small">Your note: {request.agency_note}</p>}
      {request.decline_reason && <div className="notice danger">Declined: {request.decline_reason}</div>}
      {request.status === 'pending' && <p className="muted">Waiting for a quote.</p>}
      {request.status === 'accepted' && <p className="muted">You accepted this quote. It's waiting to be booked.</p>}
      {request.quote && (
        <p>Quote <strong>{formatRupees(request.quote.total_paise)}</strong> <span className="muted small">({formatRupees(request.quote.ticket_price_paise)} ticket + {formatRupees(request.quote.service_charge_paise)} service charge)</span>
          {request.quote.note && <span className="muted small"> · {request.quote.note}</span>}</p>
      )}
      {request.booking_id && <p><Link to={`/bookings/${request.booking_id}`}>Open the booking</Link></p>}
      <Notice error={error} />
      {open && (
        <div className="row request-actions">
          {request.status === 'quoted' && request.quote && <button className="primary" disabled={busy} onClick={accept}>Accept {formatRupees(request.quote.total_paise)}</button>}
          <button className="ghost" disabled={busy} onClick={cancel}>Cancel request</button>
        </div>
      )}
    </Panel>
  );
}

export function PortalRequests({ onChanged }: { onChanged: () => void }) {
  const [offset, setOffset] = useState(0);
  const requests = useApi<{ items: PortalRequest[]; next_offset: number | null }>(`/portal/journey-requests?limit=30&offset=${offset}`);
  const [notice, setNotice] = useState('');
  const changed = () => { requests.reload(); onChanged(); };
  return (
    <>
      <PageHeader title="Journey requests" subtitle="Ask for a journey, then accept the quote"
        action={<Link className="button primary" to="/requests/new"><Plus aria-hidden="true" size={16} /> Request a journey</Link>} />
      <Notice error={requests.error} />
      {notice && <div className="notice warn" role="alert">{notice}</div>}
      {requests.loading ? <Loading /> : !requests.data?.items.length ? <Panel><Empty>You haven't requested any journeys yet.</Empty></Panel>
        : requests.data.items.map((request) => <RequestCard key={`${request.id}-${request.status}-${request.quote?.total_paise ?? 0}`} request={request}
          onChanged={changed} onQuoteChanged={setNotice} />)}
      <div className="row pager">
        {offset > 0 && <button className="ghost" onClick={() => setOffset(Math.max(0, offset - 30))}>Newer</button>}
        {requests.data?.next_offset != null && <button className="ghost" onClick={() => setOffset(requests.data!.next_offset!)}>Older</button>}
      </div>
    </>
  );
}

export function NewRequest({ onSent }: { onSent: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = indiaToday();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(params.get('date') ?? today);
  const [train, setTrain] = useState('');
  const [ticketType, setTicketType] = useState('direct');
  const [passengers, setPassengers] = useState('1');
  const [note, setNote] = useState('');
  const [keys] = useState(createKeyHolder);
  const { busy, error, setError, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const count = Number(passengers);
    if (!Number.isInteger(count) || count < 1 || count > 500) { setError(new Error('Enter between 1 and 500 passengers.')); return; }
    void run(async () => {
      try {
        await api('/portal/journey-requests', { method: 'POST', idempotencyKey: keys.current(), body: { boarding_station: from,
          destination_station: to, journey_date: date, train_identifier: train.trim() || null, ticket_type: ticketType,
          passenger_count: count, note: note.trim() || null } });
        keys.settle();
      } catch (failure) { keys.settle(failure); throw failure; }
      onSent();
      navigate('/requests');
    });
  };
  return (
    <>
      <PageHeader title="Request a journey" subtitle="You'll get a quote here before anything is booked." />
      <form onSubmit={submit}>
        <Panel>
          <div className="form-grid">
            <Field label="From station"><input required maxLength={160} value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="To station"><input required maxLength={160} value={to} onChange={(event) => setTo(event.target.value)} /></Field>
            <Field label="Journey date"><input type="date" required min={today} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
            <Field label="Train (optional)"><input maxLength={160} value={train} onChange={(event) => setTrain(event.target.value)} placeholder="12602" /></Field>
            <Field label="Ticket type"><select value={ticketType} onChange={(event) => setTicketType(event.target.value)}>
              <option value="direct">Direct</option><option value="connected">Connected</option>
            </select></Field>
            <Field label="Passengers"><input required type="number" min={1} max={500} value={passengers} onChange={(event) => setPassengers(event.target.value)} /></Field>
          </div>
          <Field label="Note (optional)"><textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Berth preference, class, or anything else" /></Field>
        </Panel>
        <Notice error={error} />
        <div className="row form-actions">
          <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          <Link className="button ghost" to="/requests">Cancel</Link>
        </div>
      </form>
    </>
  );
}
