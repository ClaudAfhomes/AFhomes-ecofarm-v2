import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { memberLookupSchema, CUSTOMER_CATEGORY_LABELS } from '@jad/contracts';
import { Button, PageHeader, SearchField, ErrorState, EmptyState, StatusChip } from '@jad/ui';
import styles from './MemberLookupPage.module.css';
import { requestList } from '../../lib/api/client';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
export function MemberLookupPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  // Live lookup: the query follows the settled term (min 2 chars); the Search
  // button stays as an instant-apply fallback.
  void useDebouncedValue(search.trim(), 300, (term) => {
    if (term.length >= 2) setApplied(term);
    else setApplied('');
  });
  const activeTerm = search.trim().length >= 2 ? applied : '';
  const members = useQuery({
    queryKey: ['member-lookup', activeTerm],
    enabled: activeTerm.length >= 2,
    queryFn: () =>
      requestList(
        '/memberships/lookup?search=' + encodeURIComponent(activeTerm),
        memberLookupSchema,
      ),
    // An activation from another session updates the member state shown here.
    refetchInterval: 15_000,
  });
  return (
    <section>
      <PageHeader
        title="VIP Member Lookup"
        description="Find a member by name, membership number or card identifier."
      />
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <SearchField
          size="lg"
          busy={members.isFetching && activeTerm.length >= 2}
          label="Find member"
          value={search}
          onChange={(value) => {
            setSearch(value);
            if (value.trim().length < 2) setApplied('');
          }}
        />
        <Button size="lg" variant="secondary" type="submit" disabled={search.trim().length < 2}>
          Search
        </Button>
      </form>
      {activeTerm.length < 2 ? (
        <EmptyState title="Enter at least two characters to find a member" />
      ) : members.isPending ? (
        <p role="status">Looking up members - </p>
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={members.refetch} />
      ) : members.data?.length === 0 ? (
        <EmptyState title="No matching members" />
      ) : (
        members.data?.map((m) => (
          <article className={styles.member} key={m.membershipNumber}>
            <h2>{m.memberName}</h2>
            <p>
              {m.membershipNumber} - {m.tier} - {m.customerNumber}
            </p>
            <p>
              <strong>{CUSTOMER_CATEGORY_LABELS[m.category]}</strong> -{' '}
              {m.mayUsePrivileges ? 'VIP privileges available' : 'VIP privileges unavailable'}
            </p>
            <dl className={styles.details}>
              <div>
                <dt>Membership status</dt>
                <dd>
                  <StatusChip label={m.membershipStatus} />
                </dd>
              </div>
              <div>
                <dt>Activated</dt>
                <dd>{m.activatedAt?.slice(0, 10) ?? 'Not activated'}</dd>
              </div>
              <div>
                <dt>Valid until</dt>
                <dd>{m.expiresAt?.slice(0, 10) ?? 'Not available'}</dd>
              </div>
              <div>
                <dt>Available points</dt>
                <dd className={styles.points}>
                  {BigInt(m.availablePoints).toLocaleString('en-PH')}
                </dd>
              </div>
            </dl>
          </article>
        ))
      )}
    </section>
  );
}
