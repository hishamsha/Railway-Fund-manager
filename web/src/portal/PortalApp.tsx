import { Navigate, Route, Routes } from 'react-router-dom';
import { CalendarDays, CircleDollarSign, Home, Inbox, ReceiptText, Settings } from 'lucide-react';
import type { User } from '../api';
import { Frame, type NavItem } from '../frame';
import { useApi } from '../ui';
import { Account } from '../pages/Account';
import { PortalBookingDetail, PortalBookings } from './Bookings';
import { PortalCalendar } from './Calendar';
import { PortalHome } from './Home';
import { PortalPayments } from './Payments';
import { NewRequest, PortalRequests } from './Requests';
import type { PortalRequest, Summary } from './types';

// Every /portal API call is limited on the server to this login's own agency.
export function PortalApp({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const summary = useApi<Summary>('/portal/summary');
  const quoted = useApi<{ items: PortalRequest[] }>('/portal/journey-requests?status=quoted&limit=100');
  const refresh = () => { summary.reload(); quoted.reload(); };
  const nav: NavItem[] = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/calendar', label: 'Journey calendar', icon: CalendarDays },
    { to: '/requests', label: 'Journey requests', icon: Inbox, count: quoted.data?.items.length },
    { to: '/bookings', label: 'Bookings', icon: ReceiptText },
    { to: '/payments', label: 'Payments', icon: CircleDollarSign },
    { to: '/account', label: 'My account', icon: Settings },
  ];
  return (
    <Frame user={user} heading={summary.data?.agency.name} nav={nav} onSignOut={onSignOut}>
      <Routes>
        <Route path="/" element={<PortalHome summary={summary.data} error={summary.error} quoted={quoted.data?.items ?? []} />} />
        <Route path="/calendar" element={<PortalCalendar />} />
        <Route path="/requests" element={<PortalRequests onChanged={refresh} />} />
        <Route path="/requests/new" element={<NewRequest onSent={refresh} />} />
        <Route path="/bookings" element={<PortalBookings />} />
        <Route path="/bookings/:id" element={<PortalBookingDetail />} />
        <Route path="/payments" element={<PortalPayments />} />
        <Route path="/account" element={<Account user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Frame>
  );
}
