import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { CalendarDays, CircleDollarSign, Home, Inbox, KeyRound, LogOut, Percent, ReceiptText, Ticket, TrainFront,
  Users } from 'lucide-react';
import { refreshSession, setSignedOutHandler, signOut, type User } from './api';
import { useApi } from './ui';
import { Login } from './pages/Login';
import { Today } from './pages/Today';
import { CalendarPage } from './pages/Calendar';
import { Tickets } from './pages/Tickets';
import { Bookings } from './pages/Bookings';
import { NewBooking } from './pages/NewBooking';
import { BookingDetail } from './pages/BookingDetail';
import { Agencies } from './pages/Agencies';
import { AgencyDetail } from './pages/AgencyDetail';
import { Payments } from './pages/Payments';
import { Accounts } from './pages/Accounts';
import { Charges } from './pages/Charges';
import { Requests } from './pages/Requests';
import './styles.css';

const nav = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/requests', label: 'Requests', icon: Inbox },
  { to: '/bookings', label: 'Bookings', icon: ReceiptText },
  { to: '/tickets', label: 'Ticket tracker', icon: Ticket },
  { to: '/payments', label: 'Payments & credit', icon: CircleDollarSign },
  { to: '/agencies', label: 'Agencies', icon: Users },
  { to: '/accounts', label: 'Booking accounts', icon: KeyRound },
  { to: '/charges', label: 'Service charges', icon: Percent },
];

function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const pending = useApi<{ items: unknown[] }>('/journey-requests?status=pending&limit=100');
  const waiting = pending.data?.items.length ?? 0;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><TrainFront aria-hidden="true" /><span>Train Fund Manager</span></div>
        <nav aria-label="Main">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon aria-hidden="true" size={18} /><span>{label}</span>
              {to === '/requests' && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <div className="account-name" title={user.email}>{user.display_name ?? user.email}</div>
          <button className="ghost" onClick={onSignOut}><LogOut aria-hidden="true" size={16} /> Sign out</button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/requests" element={<Requests onChanged={pending.reload} />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/bookings/new" element={<NewBooking onBooked={pending.reload} />} />
          <Route path="/bookings/:id" element={<BookingDetail />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/agencies" element={<Agencies />} />
          <Route path="/agencies/:id" element={<AgencyDetail />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/charges" element={<Charges />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refreshSession().then((restored) => {
      if (restored?.role === 'owner') setUser(restored);
    }).catch(() => {}).finally(() => setRestoring(false));
  }, []);
  if (restoring) return <p className="empty" role="status">Loading…</p>;
  if (!user) return <Login onSignedIn={setUser} />;
  return <Shell user={user} onSignOut={() => { void signOut().finally(() => setUser(null)); }} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
