import type { ComponentType, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut, TrainFront } from 'lucide-react';
import type { User } from './api';

export type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: 'true' }>; end?: boolean; count?: number };

/** The sidebar and content area shared by the owner's admin and the agency portal. */
export function Frame({ user, heading, nav, onSignOut, children }: { user: User; heading?: string; nav: NavItem[];
  onSignOut: () => void; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><TrainFront aria-hidden="true" /><span>Train Fund Manager</span></div>
        {heading && <div className="frame-heading">{heading}</div>}
        <nav aria-label="Main">
          {nav.map(({ to, label, icon: Icon, end, count }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon aria-hidden="true" size={18} /><span>{label}</span>
              {Boolean(count) && <span className="count" aria-label={`${count} waiting`}>{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <div className="account-name" title={user.email}>{user.display_name ?? user.email}</div>
          <button className="ghost" onClick={onSignOut}><LogOut aria-hidden="true" size={16} /> Sign out</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
