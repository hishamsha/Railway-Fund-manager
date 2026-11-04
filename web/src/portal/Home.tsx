import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { formatDate, formatRupees } from '../money';
import { Empty, Loading, Notice, PageHeader, Panel, Route, Stat, StatusBadge, useApi } from '../ui';
import type { PortalJourney, PortalRequest, Summary } from './types';

export function PortalHome({ summary, error, quoted }: { summary: Summary | null; error: string | null; quoted: PortalRequest[] }) {
  const journeys = useApi<{ items: PortalJourney[] }>('/portal/journeys?limit=5');
  if (error) {
    // The API answers this way when the agency has been archived.
    const closed = error === 'This account cannot use this feature';
    return <Notice error={closed ? 'This portal is closed for your agency. Please contact your ticket provider.' : error} />;
  }
  if (!summary) return <Loading />;
  const inCredit = summary.advance_credit_paise > 0;
  return (
    <>
      <PageHeader title={summary.agency.name} subtitle={formatDate(summary.date)}
        action={<Link className="button primary" to="/requests/new"><Plus aria-hidden="true" size={16} /> Request a journey</Link>} />
      <div className="stats">
        <Stat label={inCredit ? 'You are in credit' : 'You owe'} value={formatRupees(inCredit ? summary.advance_credit_paise : summary.net_due_paise)}
          tone={summary.net_due_paise > 0 ? 'danger' : 'good'} />
        <Stat label="Overdue" value={formatRupees(summary.overdue_paise)} tone={summary.overdue_paise > 0 ? 'danger' : undefined} />
        {summary.available_credit_paise !== null && <Stat label={`Credit left of ${formatRupees(summary.credit_limit_paise ?? 0)}`}
          value={formatRupees(summary.available_credit_paise)} tone={summary.available_credit_paise < 0 ? 'danger' : undefined} />}
        <Stat label="Upcoming tickets" value={String(summary.upcoming_ticket_count)} />
      </div>
      {summary.overdue_paise > 0 && summary.oldest_due_date && (
        <div className="notice warn" role="status">Some payment has been due since {formatDate(summary.oldest_due_date)}.</div>
      )}
      {quoted.length > 0 && (
        <Panel title="Quotes waiting for your answer" action={<Link to="/requests">See requests</Link>}>
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Date</th><th className="num">Quote</th></tr></thead>
            <tbody>{quoted.map((request) => (
              <tr key={request.id}>
                <td><Link to="/requests"><Route from={request.boarding_station} to={request.destination_station} /></Link></td>
                <td className="nowrap">{formatDate(request.journey_date)}</td>
                <td className="num">{formatRupees(request.quote?.total_paise ?? 0)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}
      <Panel title="Next journeys" action={<Link to="/calendar">Open calendar</Link>}>
        <Notice error={journeys.error} />
        {journeys.loading ? <Loading /> : !journeys.data?.items.length ? <Empty>No upcoming journeys.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Journey</th><th>Date</th><th>PNR</th><th>Status</th></tr></thead>
            <tbody>{journeys.data.items.map((leg) => (
              <tr key={leg.id}>
                <td><Link to={`/bookings/${leg.booking_id}`}><Route from={leg.boarding_station} to={leg.destination_station} /></Link>
                  <div className="muted small">Train {leg.train_identifier}</div></td>
                <td className="nowrap">{formatDate(leg.journey_date)}</td>
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
