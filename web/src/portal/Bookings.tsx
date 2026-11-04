import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate, formatRupees } from '../money';
import { Due, Empty, Loading, Notice, PageHeader, Panel, Route, Stat, StatusBadge, useApi } from '../ui';
import type { PortalBooking } from './types';

const scopes = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']] as const;

export function PortalBookings() {
  const [scope, setScope] = useState<string>('upcoming');
  const [offset, setOffset] = useState(0);
  const bookings = useApi<{ items: PortalBooking[]; next_offset: number | null }>(`/portal/bookings?scope=${scope}&limit=30&offset=${offset}`);
  return (
    <>
      <PageHeader title="Bookings" subtitle="Your tickets and what's owed on each" />
      <div className="tabs" role="group" aria-label="Which bookings">
        {scopes.map(([value, label]) => <button key={value} aria-pressed={scope === value} className={scope === value ? 'tab active' : 'tab'}
          onClick={() => { setScope(value); setOffset(0); }}>{label}</button>)}
      </div>
      <Panel>
        <Notice error={bookings.error} />
        {bookings.loading ? <Loading /> : !bookings.data?.items.length ? <Empty>No bookings here.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Due</th></tr></thead>
            <tbody>{bookings.data.items.map((booking) => (
              <tr key={booking.id}>
                <td><Link to={`/bookings/${booking.id}`}><Route from={booking.boarding_station} to={booking.destination_station} /></Link>
                  <div className="muted small">Train {booking.train_identifier}</div></td>
                <td className="nowrap">{formatDate(booking.journey_date)}</td>
                <td className="num">{formatRupees(booking.total_payable_paise)}</td>
                <td className="num">{formatRupees(booking.collected_paise)}</td>
                <td className="num"><Due paise={booking.balance_due_paise} />
                  {booking.advance_credit_paise > 0 && <div className="muted small">{formatRupees(booking.advance_credit_paise)} credit</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="row pager">
          {offset > 0 && <button className="ghost" onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</button>}
          {bookings.data?.next_offset != null && <button className="ghost" onClick={() => setOffset(bookings.data!.next_offset!)}>Next</button>}
        </div>
      </Panel>
    </>
  );
}

export function PortalBookingDetail() {
  const { id } = useParams();
  const detail = useApi<{ booking: PortalBooking }>(`/portal/bookings/${id}`);
  if (detail.error) return <Notice error={detail.error} />;
  const booking = detail.data?.booking;
  if (!booking) return <Loading />;
  const hasCancelled = booking.legs.some((leg) => leg.ticket_status === 'cancelled');
  return (
    <>
      <PageHeader title={`${booking.boarding_station} → ${booking.destination_station}`}
        subtitle={`${formatDate(booking.journey_date)} · ${booking.ticket_type === 'connected' ? 'Connected' : 'Direct'} ticket${booking.booking_person_mobile ? ` · ${booking.booking_person_mobile}` : ''}`} />
      {hasCancelled && <div className="notice info" role="status">A cancelled ticket doesn't count toward what you owe, except any cancellation charge shown.</div>}
      <div className="stats">
        <Stat label="Total" value={formatRupees(booking.total_payable_paise)} />
        <Stat label="Paid" value={formatRupees(booking.collected_paise)} />
        <Stat label={booking.advance_credit_paise > 0 ? 'In credit' : 'Balance due'} value={formatRupees(booking.advance_credit_paise || booking.balance_due_paise)}
          tone={booking.balance_due_paise > 0 ? 'danger' : 'good'} />
      </div>
      <Panel title="Details">
        <dl className="details">
          <div><dt>Tickets</dt><dd>{formatRupees(booking.ticket_price_paise)}</dd></div>
          <div><dt>Service charge</dt><dd>{formatRupees(booking.service_charge_paise)}</dd></div>
          <div><dt>Payment due</dt><dd>{formatDate(booking.due_date)}</dd></div>
        </dl>
      </Panel>
      <Panel title="Tickets">
        <div className="table-wrap"><table>
          <thead><tr><th>Journey</th><th>Date</th><th>Train</th><th className="num">Fare</th><th>PNR</th><th>Status</th></tr></thead>
          <tbody>{booking.legs.map((leg) => (
            <tr key={leg.id}>
              <td><Route from={leg.boarding_station} to={leg.destination_station} /></td>
              <td className="nowrap">{formatDate(leg.journey_date)}</td>
              <td>{leg.train_identifier}</td>
              <td className="num">{leg.ticket_status === 'cancelled' ? <>
                <s>{formatRupees(leg.fare_paise)}</s>
                <div className="muted small">{leg.cancellation_charge_paise > 0 ? `${formatRupees(leg.cancellation_charge_paise)} charge` : 'No charge'}</div>
              </> : formatRupees(leg.fare_paise)}</td>
              <td>{leg.pnr ?? '—'}</td>
              <td><StatusBadge status={leg.ticket_status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
