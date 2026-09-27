import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
import { getOstMembers } from './services';

/**
 * OST members. Each row links into the genealogy screen, where the SM -> OST
 * edge is visible under the same authorization as the rest of the network.
 */
export function OstMembersPage() {
  const query = useQuery({ queryKey: ['ost', 'members'], queryFn: getOstMembers });

  return (
    <section>
      <PageHeader
        title="OST Members"
        description="Approved OST sellers and the Sales Manager each one serves under."
      />
      {query.isPending ? (
        <p role="status">Loading members…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState
          title="No OST members"
          description="Approved applications create a member row here."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>OST number</th>
                <th>Name</th>
                <th>Email</th>
                <th>Sponsor</th>
                <th>Status</th>
                <th>Approved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((member) => (
                <tr key={member.id}>
                  <td>{member.ostNumber}</td>
                  <td>{member.fullName}</td>
                  <td>{member.email}</td>
                  <td>{member.sponsorName}</td>
                  <td>
                    <StatusChip
                      label={member.status}
                      tone={member.status === 'active' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>{formatDateTime(member.approvedAt)}</td>
                  <td>
                    <Link to={`/admin/genealogy/${member.id}`}>Genealogy</Link>
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
