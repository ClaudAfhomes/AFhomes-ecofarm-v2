import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerLookupSchema, CUSTOMER_CATEGORY_LABELS } from '@jad/contracts';
import { Button, PageHeader, SearchField, ErrorState, EmptyState, StatusChip } from '@jad/ui';
import styles from './MemberLookupPage.module.css';
import { requestList } from '../../lib/api/client';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

/**
 * Customer Lookup for the GSD / Employee desk.
 *
 * NOT the VIP Member Lookup that used to sit here. That screen is a member-
 * TRANSACTION view: it lists only members, shows the Membership Code, and is
 * reached on the way to spending points. This one answers a different question -
 * "does this customer exist, and what state are they in?" - for prospects and
 * non-members included.
 *
 * The Membership Code is absent from this screen by construction. It is not
 * hidden with CSS and not filtered at render time: `customerLookupSchema` has no
 * field for it, so there is nothing to leak, and the endpoint does not match a
 * Membership Code in the first place. A GSD operator who needs to redeem points
 * goes to Membership Transaction, which is a separate screen and a separate
 * credential path.
 */
export function CustomerLookupPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  // Live lookup on the settled term (min 2 chars); the Search button stays as an
  // instant-apply fallback for a fast typist.
  void useDebouncedValue(search.trim(), 300, (term) => {
    if (term.length >= 2) setApplied(term);
    else setApplied('');
  });
  const activeTerm = search.trim().length >= 2 ? applied : '';
  const customers = useQuery({
    queryKey: ['customer-lookup', activeTerm],
    enabled: activeTerm.length >= 2,
    queryFn: () =>
      requestList(
        '/memberships/customer-lookup?search=' + encodeURIComponent(activeTerm),
        customerLookupSchema,
      ),
    refetchInterval: 30_000,
  });
  return (
    <section>
      <PageHeader
        title="Customer Lookup"
        description="Find any customer by Customer ID, Customer Code, or name. Read-only."
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
          busy={customers.isFetching && activeTerm.length >= 2}
          label="Find customer"
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
        <EmptyState title="Enter at least two characters to find a customer" />
      ) : customers.isPending ? (
        <p role="status">Looking up customers - </p>
      ) : customers.isError ? (
        <ErrorState error={customers.error} onRetry={customers.refetch} />
      ) : customers.data?.length === 0 ? (
        <EmptyState title="No matching customers" />
      ) : (
        customers.data?.map((c) => (
          <article className={styles.member} key={c.customerNumber}>
            <h2>{c.fullName}</h2>
            <p>
              {c.customerNumber}
              {c.customerCode ? ` - ${c.customerCode}` : ''}
            </p>
            <p>
              <strong>{CUSTOMER_CATEGORY_LABELS[c.category]}</strong>
            </p>
            {/* Customer Status and Membership Status are shown as separate facts,
                never merged. An active customer can hold a suspended membership, and
                conflating the two tells an operator the wrong thing about the record
                in front of them. */}
            <dl className={styles.details}>
              <div>
                <dt>Customer status</dt>
                <dd>
                  <StatusChip label={c.customerStatus} />
                </dd>
              </div>
              <div>
                <dt>Membership status</dt>
                <dd>{c.membershipStatus ? <StatusChip label={c.membershipStatus} /> : 'None'}</dd>
              </div>
              <div>
                <dt>VIP tier</dt>
                <dd>{c.tier ?? 'None'}</dd>
              </div>
              <div>
                <dt>Valid until</dt>
                <dd>{c.membershipExpiresAt?.slice(0, 10) ?? 'Not applicable'}</dd>
              </div>
            </dl>
          </article>
        ))
      )}
    </section>
  );
}
