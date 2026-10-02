import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { memberLookupSchema, CUSTOMER_CATEGORY_LABELS } from '@jad/contracts';
import { Button, PageHeader, SearchField, ErrorState, EmptyState } from '@jad/ui';
import { requestList } from '../../lib/api/client';
export function MemberLookupPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const members = useQuery({
    queryKey: ['member-lookup', applied],
    enabled: applied.length >= 2,
    queryFn: () =>
      requestList('/memberships/lookup?search=' + encodeURIComponent(applied), memberLookupSchema),
  });
  return (
    <section>
      <PageHeader
        title="VIP Member Lookup"
        description="Find a member by name, membership number or card identifier."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <SearchField label="Find member" value={search} onChange={setSearch} />
        <Button type="submit" disabled={search.trim().length < 2}>
          Search
        </Button>
      </form>
      {members.isFetching ? (
        <p role="status">Looking up members - </p>
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={members.refetch} />
      ) : members.data?.length === 0 ? (
        <EmptyState title="No matching members" />
      ) : (
        members.data?.map((m) => (
          <article key={m.membershipNumber}>
            <h2>{m.memberName}</h2>
            <p>
              {m.membershipNumber} - {m.tier} - {m.customerNumber}
            </p>
            <p>
              <strong>{CUSTOMER_CATEGORY_LABELS[m.category]}</strong> -{' '}
              {m.mayUsePrivileges ? 'VIP privileges available' : 'VIP privileges unavailable'}
            </p>
            <p>
              Membership: {m.membershipStatus}; activated {m.activatedAt?.slice(0, 10) ?? ' - '};
              expires {m.expiresAt?.slice(0, 10) ?? ' - '}
            </p>
            <p>Available points: {m.availablePoints}</p>
          </article>
        ))
      )}
    </section>
  );
}
