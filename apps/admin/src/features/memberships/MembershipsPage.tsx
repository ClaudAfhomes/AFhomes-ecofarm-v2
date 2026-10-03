import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
} from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
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
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['memberships', status],
    queryFn: () => getMemberships(status),
    // Card status changes on the activation queue and detail screens.
    refetchInterval: 30_000,
  });
  const rows = (query.data ?? []).filter(
    (m) =>
      debouncedSearch.trim().length === 0 ||
      m.customerName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      m.membershipNumber.toLowerCase().includes(debouncedSearch.toLowerCase()),
  );

  return (
    <section>
      <PageHeader
        title="Memberships"
        description="Issued member cards. Open a card to print it or to rotate its credentials."
      />

      <FilterBar
        search={
          <SearchField
            label="Search member or number"
            placeholder="Name or MBS-…"
            value={search}
            onChange={setSearch}
          />
        }
        filters={
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              ...STATUSES.filter(Boolean).map((value) => ({ value, label: value })),
            ]}
          />
        }
      />

      {query.isPending ? (
        <p role="status">Loading memberships…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState title="No memberships" description="Activated cards appear here." />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Number</th>
                <th>Tier</th>
                <th>Category</th>
                <th>Status</th>
                <th>Points</th>
                <th>Activated</th>
                <th>Valid until</th>
                <th>Card Issued</th>
                <th>Last Printed</th>
                <th>Prints</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.customerName}</td>
                  <td>{m.membershipNumber}</td>
                  <td>{m.productName ?? '—'}</td>
                  <td>{m.categoryName ?? '—'}</td>
                  <td>
                    <StatusChip
                      label={m.status}
                      tone={m.status === 'active' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>{m.pointsBalance.toLocaleString('en-PH')}</td>
                  <td>{m.activatedAt ? formatDateTime(m.activatedAt) : '—'}</td>
                  <td>{m.expiresAt ? formatDateTime(m.expiresAt) : '—'}</td>
                  <td>{m.cardIssuedAt ? formatDateTime(m.cardIssuedAt) : '—'}</td>
                  <td>{m.lastPrintedAt ? formatDateTime(m.lastPrintedAt) : '—'}</td>
                  <td>{m.printCount}</td>
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
