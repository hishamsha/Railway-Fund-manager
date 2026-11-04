import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { TrackedLeg } from '../api';
import { formatDate, formatRupees } from '../money';
import { AgencyLink, Due, Empty, Loading, Notice, PageHeader, Panel, Route, Stat, StatusBadge, useApi } from '../ui';

type DueItem = { booking_id: string; packager_id: string; packager_name: string; boarding_station: string;
  destination_station: string; journey_date: string; due_date: string; balance_due_paise: number };
type DueList = { total_due_paise: number; items: DueItem[] };
type Agenda = { date: string; tomorrow: string; today_journeys: TrackedLeg[]; tomorrow_journeys: TrackedLeg[];
  payments_due_today: DueList; overdue_payments: DueList };
type Dashboard = { booking_count: number; packager_count: number; balance_due_paise: number; collected_paise: number;
  service_charge_paise: number };

function Journeys({ legs, none }: { legs: TrackedLeg[]; none: string }) {
  if (!legs.length) return <Empty>{none}</Empty>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Journey</th><th>Agency</th><th>PNR</th><th>Status</th></tr></thead>
      <tbody>{legs.map((leg) => (
        <tr key={leg.id}>
          <td><Link to={`/bookings/${leg.booking_id}`}><Route from={leg.boarding_station} to={leg.destination_station} /></Link>
            <div className="muted small">Train {leg.train_identifier}{leg.booking_person_mobile ? ` · ${leg.booking_person_mobile}` : ''}</div></td>
          <td><AgencyLink id={leg.packager_id} name={leg.packager_name} /></td>
          <td>{leg.pnr ?? <span className="warn-text">Not added</span>}</td>
          <td><StatusBadge status={leg.ticket_status} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function DueTable({ list, none }: { list: DueList; none: string }) {
  if (!list.items.length) return <Empty>{none}</Empty>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Agency</th><th>Journey</th><th>Due date</th><th className="num">Balance</th></tr></thead>
      <tbody>{list.items.map((item) => (
        <tr key={item.booking_id}>
          <td><AgencyLink id={item.packager_id} name={item.packager_name} /></td>
          <td><Link to={`/bookings/${item.booking_id}`}><Route from={item.boarding_station} to={item.destination_station} /></Link></td>
          <td>{formatDate(item.due_date)}</td>
          <td className="num"><Due paise={item.balance_due_paise} /></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function Today() {
  const agenda = useApi<Agenda>('/agenda');
  const dashboard = useApi<Dashboard>('/dashboard');
  return (
    <>
      <PageHeader title="Today" subtitle={agenda.data ? formatDate(agenda.data.date) : undefined}
        action={<Link className="button primary" to="/bookings/new"><Plus aria-hidden="true" size={16} /> New booking</Link>} />
      <Notice error={agenda.error ?? dashboard.error} />
      {dashboard.data && (
        <div className="stats">
          <Stat label="Due across bookings, before advances" value={formatRupees(dashboard.data.balance_due_paise)}
            tone={dashboard.data.balance_due_paise > 0 ? 'danger' : undefined} />
          <Stat label="Collected, all time" value={formatRupees(dashboard.data.collected_paise)} />
          <Stat label="Service charges billed" value={formatRupees(dashboard.data.service_charge_paise)} />
          <Stat label="Bookings" value={String(dashboard.data.booking_count)} />
        </div>
      )}
      {agenda.loading && <Loading />}
      {agenda.data && (
        <>
          <Panel title={`Tomorrow's journeys · ${formatDate(agenda.data.tomorrow)}`}>
            <Journeys legs={agenda.data.tomorrow_journeys} none="No journeys tomorrow." />
          </Panel>
          <Panel title="Today's journeys">
            <Journeys legs={agenda.data.today_journeys} none="No journeys today." />
          </Panel>
          <Panel title={`Due today · ${formatRupees(agenda.data.payments_due_today.total_due_paise)}`}>
            <DueTable list={agenda.data.payments_due_today} none="No payments due today." />
          </Panel>
          <Panel title={`Overdue · ${formatRupees(agenda.data.overdue_payments.total_due_paise)}`}>
            <DueTable list={agenda.data.overdue_payments} none="Nothing is overdue." />
          </Panel>
        </>
      )}
    </>
  );
}
