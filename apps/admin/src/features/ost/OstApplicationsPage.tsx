import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorState, FilterBar, PageHeader, Select, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { getOstApplications } from './services';

const STATUSES = [
  '',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
];

/**
 * OST application queue. Sellers see only the applications they sponsor (the
 * server scopes the list); reviewers see every reviewable application.
 * Approving or rejecting happens on the detail screen, never from this list.
 */
export function OstApplicationsPage() {
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: ['ost', 'applications', status],
    queryFn: () => getOstApplications(status),
  });

  return (
    <section>
      <PageHeader
        title="OST Applications"
        description="Registration applications under your Sales Manager referral. The sponsor is frozen at submission and cannot be changed here."
      />

      <FilterBar
        filters={
          <label style={{ display: 'grid', gap: 4, fontSize: 14, fontWeight: 600 }}>
            Status
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={STATUSES.map((value) => ({
                value,
                label: value ? value.replace(/_/g, ' ') : 'All statuses',
              }))}
            />
          </label>
        }
      />

      {query.isPending ? (
        <p role="status">Loading applications…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title="No OST applications"
          description="New registrations submitted with your referral code appear here."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Email</th>
                <th>Sponsor</th>
                <th>Submitted</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((app) => (
                <tr key={app.id}>
                  <td>{app.applicantName}</td>
                  <td>{app.email}</td>
                  <td>{app.sponsorName}</td>
                  <td>{formatDateTime(app.submittedAt)}</td>
                  <td>
                    <StatusChip
                      label={app.status.replace(/_/g, ' ')}
                      tone={
                        app.status === 'approved'
                          ? 'success'
                          : app.status === 'rejected'
                            ? 'danger'
                            : 'neutral'
                      }
                    />
                  </td>
                  <td>
                    <Link to={`/admin/ost/applications/${app.id}`}>Review</Link>
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
