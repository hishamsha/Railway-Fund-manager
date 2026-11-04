import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CalendarDays, CircleDollarSign, Home, Inbox, KeyRound, Percent, ReceiptText, Settings, Ticket, Users } from 'lucide-react';
import { refreshSession, setSignedOutHandler, signOut, type User } from './api';
import { Frame, type NavItem } from './frame';
import { useApi } from './ui';
import { Account } from './pages/Account';
import { Login } from './pages/Login';
import { Today } from './pages/Today';
import { CalendarPage } from './pages/Calendar';
import { Tickets } from './pages/Tickets';
import { Bookings } from './pages/Bookings';
import { NewBooking } from './pages/NewBooking';
import { BookingDetail } from './pages/BookingDetail';
import { EditBooking } from './pages/EditBooking';
import { Agencies } from './pages/Agencies';
import { AgencyDetail } from './pages/AgencyDetail';
import { Payments } from './pages/Payments';
import { Accounts } from './pages/Accounts';
import { Charges } from './pages/Charges';
import { Requests } from './pages/Requests';
import { PortalApp } from './portal/PortalApp';
import './styles.css';

function OwnerApp({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const pending = useApi<{ items: unknown[] }>('/journey-requests?status=pending&limit=100');
  const nav: NavItem[] = [
    { to: '/', label: 'Today', icon: Home, end: true },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/requests', label: 'Requests', icon: Inbox, count: pending.data?.items.length },
    { to: '/bookings', label: 'Bookings', icon: ReceiptText },
    { to: '/tickets', label: 'Ticket tracker', icon: Ticket },
    { to: '/payments', label: 'Payments & credit', icon: CircleDollarSign },
    { to: '/agencies', label: 'Agencies', icon: Users },
    { to: '/accounts', label: 'Booking accounts', icon: KeyRound },
    { to: '/charges', label: 'Service charges', icon: Percent },
    { to: '/account', label: 'My account', icon: Settings },
  ];
  return (
    <Frame user={user} nav={nav} onSignOut={onSignOut}>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/requests" element={<Requests onChanged={pending.reload} />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/bookings/new" element={<NewBooking onBooked={pending.reload} />} />
        <Route path="/bookings/:id" element={<BookingDetail />} />
        <Route path="/bookings/:id/edit" element={<EditBooking />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/agencies" element={<Agencies />} />
        <Route path="/agencies/:id" element={<AgencyDetail />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/charges" element={<Charges />} />
        <Route path="/account" element={<Account user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Frame>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refreshSession().then(setUser).catch(() => {}).finally(() => setRestoring(false));
  }, []);
  if (restoring) return <p className="empty" role="status">Loading…</p>;
  if (!user) return <Login onSignedIn={setUser} />;
  const leave = () => { void signOut().finally(() => setUser(null)); };
  // The API enforces these roles on every route. This only picks which screens to show.
  return user.role === 'agency' ? <PortalApp user={user} onSignOut={leave} /> : <OwnerApp user={user} onSignOut={leave} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
