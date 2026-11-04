import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TrackedLeg } from '../api';
import { addDays, formatDate, indiaToday } from '../money';
import { AgencyLink, Empty, Loading, Notice, PageHeader, Panel, Route, StatusBadge, useApi } from '../ui';

type Day = { date: string; total: number; by_status: Record<string, number> };

export function monthGrid(month: string) {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -((weekday + 6) % 7)); // Weeks start on Monday.
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
export function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
}

export function CalendarPage() {
  const today = indiaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const grid = useMemo(() => monthGrid(month), [month]);
  const calendar = useApi<{ days: Day[] }>(`/calendar?from_date=${grid[0]}&to_date=${grid[41]}`);
  const tickets = useApi<{ items: TrackedLeg[] }>(`/tickets?from_date=${selected}&to_date=${selected}&limit=100`);
  const days = new Map((calendar.data?.days ?? []).map((day) => [day.date, day]));
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader title="Calendar" subtitle="Tickets by journey date" />
      <Notice error={calendar.error ?? tickets.error} />
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
            const day = days.get(date);
            const waiting = (day?.by_status.waitlisted ?? 0) + (day?.by_status.rac ?? 0);
            const active = (day?.total ?? 0) - (day?.by_status.cancelled ?? 0);
            return (
              <button key={date} className={['calendar-day', date.slice(0, 7) !== month ? 'outside' : '',
                date === today ? 'today' : '', date === selected ? 'selected' : ''].join(' ')}
                aria-pressed={date === selected} aria-label={`${formatDate(date)}, ${active} tickets`}
                onClick={() => setSelected(date)}>
                <span className="calendar-date">{Number(date.slice(8))}</span>
                {active > 0 && <span className="calendar-count">{active}<span className="wide-only"> ticket{active === 1 ? '' : 's'}</span></span>}
                {waiting > 0 && <span className="calendar-warn">{waiting}<span className="wide-only"> waiting</span></span>}
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title={formatDate(selected)}>
        {tickets.loading ? <Loading /> : !tickets.data?.items.length ? <Empty>No tickets on this date.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Agency</th><th>PNR</th><th>Status</th></tr></thead>
            <tbody>{tickets.data.items.map((leg) => (
              <tr key={leg.id}>
                <td><Link to={`/bookings/${leg.booking_id}`}><Route from={leg.boarding_station} to={leg.destination_station} /></Link>
                  <div className="muted small">Train {leg.train_identifier}</div></td>
                <td><AgencyLink id={leg.packager_id} name={leg.packager_name} /></td>
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
