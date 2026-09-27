import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { getMemberships } from './services';

const STATUSES = ['', 'active', 'expired', 'suspended', 'cancelled'];

/**
 * Membership (card) management queue.
 *
 * Cards are identified by membership number and tier. Credential codes are
 * never listed here: hash-only storage means they cannot be recovered, only
 * rotated on the detail screen, where the new pair is shown exactly once.
 */
export function MembershipsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['memberships', status],
    queryFn: () => getMemberships(status),
  });
  const rows = (query.data ?? []).filter(
    (m) =>
      search.trim().length === 0 ||
      m.customerName.toLowerCase().includes(search.toLowerCase()) ||
      m.membershipNumber.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section>
      <PageHeader
        title="Memberships"
        description="Issued member cards. Open a card to print it or to rotate its credentials."
      />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label>
          Search member or number
          <input
            aria-label="Search member or number"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or MBS-…"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value || 'All statuses'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isPending ? (
        <p role="status">Loading memberships…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No memberships" description="Activated cards appear here." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Number</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Points</th>
                <th>Activated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.customerName}</td>
                  <td>{m.membershipNumber}</td>
                  <td>{m.productName ?? '—'}</td>
                  <td>
                    <StatusChip
                      label={m.status}
                      tone={m.status === 'active' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>{m.pointsBalance.toLocaleString('en-PH')}</td>
                  <td>{m.activatedAt ? formatDateTime(m.activatedAt) : '—'}</td>
                  <td>
                    <Link to={`/admin/memberships/${m.id}`}>Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
