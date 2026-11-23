import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@afhomes/ui';

import { useSession } from '../../lib/session';
import { getStaffAlerts } from './services';
import local from './Engagement.module.css';

/**
 * Header bell: what is waiting for staff. The server returns `null` for each
 * area the caller cannot view, and those entries are not shown; with nothing
 * visible the bell is not rendered at all. Informational only, every link
 * lands on a page that checks its own permission.
 */
export function StaffAlertsBell() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const alerts = useQuery({
    queryKey: ['staff-alerts'],
    queryFn: getStaffAlerts,
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });

  if (!alerts.data) return null;
  const entries = [
    { to: '/admin/sales/inquiries', label: 'Website Inquiries', count: alerts.data.newInquiries },
    { to: '/admin/bookings', label: 'Bookings', count: alerts.data.requestedBookings },
    { to: '/admin/messages', label: 'Messages', count: alerts.data.awaitingReply },
  ].filter((e): e is typeof e & { count: number } => e.count !== null);
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className={local.bell}>
      <button
        type="button"
        className={local.bellButton}
        aria-label={total > 0 ? `Alerts, ${total} waiting` : 'Alerts, nothing waiting'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={20} />
        {total > 0 ? (
          <span className={local.bellCount} aria-hidden="true">
            {total > 99 ? '99+' : total}
          </span>
        ) : null}
      </button>
      {open ? (
        <ul className={local.bellMenu} aria-label="Waiting for you">
          {entries.map((e) => (
            <li key={e.to}>
              <Link to={e.to} onClick={() => setOpen(false)}>
                <span>{e.label}</span>
                <strong>{e.count}</strong>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
