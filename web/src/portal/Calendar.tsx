import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatDate, indiaToday } from '../money';
import { monthGrid, shiftMonth } from '../pages/Calendar';
import { Empty, Loading, Notice, PageHeader, Panel, Route, StatusBadge, useApi } from '../ui';
import type { PortalJourney } from './types';

export function PortalCalendar() {
  const today = indiaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const grid = useMemo(() => monthGrid(month), [month]);
  const journeys = useApi<{ items: PortalJourney[]; next_offset: number | null }>(
    `/portal/journeys?from_date=${grid[0]}&to_date=${grid[41]}&limit=100`);
  const byDate = new Map<string, PortalJourney[]>();
  for (const leg of journeys.data?.items ?? []) byDate.set(leg.journey_date, [...(byDate.get(leg.journey_date) ?? []), leg]);
  const dayLegs = byDate.get(selected) ?? [];
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader title="Journey calendar" subtitle="Your tickets by journey date. Cancelled tickets aren't shown." />
      <Notice error={journeys.error} />
      {journeys.data?.next_offset != null && <div className="notice warn" role="status">This month has more tickets than the calendar can show. See Bookings for all of them.</div>}
      <Panel title={title} action={
        <div className="row">
          <button className="ghost icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
          <button className="ghost" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button>
          <button className="ghost icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
        </div>
      }>
        <div className="calendar">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => <div key={name} className="calendar-head">{name}</div>)}
          {grid.map((date) => {
            const legs = byDate.get(date) ?? [];
            const waiting = legs.filter((leg) => ['waitlisted', 'rac'].includes(leg.ticket_status)).length;
            return (
              <button key={date} className={['calendar-day', date.slice(0, 7) !== month ? 'outside' : '',
                date === today ? 'today' : '', date === selected ? 'selected' : ''].join(' ')}
                aria-pressed={date === selected} aria-label={`${formatDate(date)}, ${legs.length} tickets`} onClick={() => setSelected(date)}>
                <span className="calendar-date">{Number(date.slice(8))}</span>
                {legs.length > 0 && <span className="calendar-count">{legs.length}<span className="wide-only"> ticket{legs.length === 1 ? '' : 's'}</span></span>}
                {waiting > 0 && <span className="calendar-warn">{waiting}<span className="wide-only"> waiting</span></span>}
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title={formatDate(selected)} action={selected >= today &&
        <Link className="button ghost" to={`/requests/new?date=${selected}`}><Plus aria-hidden="true" size={16} /> Request a journey on this date</Link>}>
        {journeys.loading ? <Loading /> : !dayLegs.length ? <Empty>No tickets on this date.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>PNR</th><th>Status</th></tr></thead>
            <tbody>{dayLegs.map((leg) => (
              <tr key={leg.id}>
                <td><Link to={`/bookings/${leg.booking_id}`}><Route from={leg.boarding_station} to={leg.destination_station} /></Link>
                  <div className="muted small">Train {leg.train_identifier}</div></td>
                <td>{leg.pnr ?? '—'}</td>
                <td><StatusBadge status={leg.ticket_status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
