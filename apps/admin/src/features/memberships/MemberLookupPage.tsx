import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { memberLookupSchema, CUSTOMER_CATEGORY_LABELS } from '@afhomes/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchField,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import styles from './MemberLookupPage.module.css';
import { requestList } from '../../lib/api/client';
import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { TierBadge } from '../business/TierBadge';

/**
 * VIP member lookup for the service desk.
 *
 * Live lookup over members only: the query follows the settled term (minimum
 * two characters) and the Search button stays as an instant-apply fallback.
 * Typing below the minimum clears the results immediately, so a stale card
 * for a previous term never lingers beside a new search. The card shows
 * privilege availability and the exact points figure; credential codes are
 * never part of this screen.
 */
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
    queryKey: membershipKeys.memberLookup(activeTerm),
    enabled: activeTerm.length >= 2,
    queryFn: () =>
      requestList(
        '/memberships/lookup?search=' + encodeURIComponent(activeTerm),
        memberLookupSchema,
      ),
    // A background refresh (activation from another session, polling) keeps
    // the current card on screen while the next page loads.
    placeholderData: keepPreviousData,
    // An activation from another session updates the member state shown here.
    refetchInterval: 15_000,
  });
  return (
    <section className={styles.page}>
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
        <div
          className={styles.results}
          role="status"
          aria-label="Looking up members"
          aria-busy="true"
        >
          <span className="sr-only">Looking up members…</span>
          {[0, 1].map((index) => (
            <div className={styles.member} data-tier="NONE" aria-hidden="true" key={index}>
              <div className={styles.artWrap}>
                <div className={styles.artSkeleton} />
              </div>
              <div className={styles.cardBody}>
                <span className={styles.skeletonTitle} style={{ width: '14rem' }} />
                <span className={styles.skeletonLine} style={{ width: '11rem' }} />
                <div className={styles.details}>
                  {[0, 1, 2, 3].map((fact) => (
                    <div className={styles.fact} key={fact}>
                      <span className={styles.factSkeletonIcon} />
                      <div className={styles.factText}>
                        <span className={styles.skeletonLine} style={{ width: '60%' }} />
                        <span className={styles.skeletonLine} style={{ width: '90%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : members.isError ? (
        <ErrorState
          error={members.error}
          title="Member lookup is unavailable right now"
          message={describeMemberLookupError(members.error)}
          onRetry={() => void members.refetch()}
        />
      ) : members.data?.length === 0 ? (
        <EmptyState
          title="No matching members"
          description="Check the spelling, or try a membership number."
        />
      ) : (
        <div className={styles.results}>
          {members.data?.map((m) => (
            <article className={styles.member} data-tier={m.tier} key={m.membershipNumber}>
              <div className={styles.cardBody}>
                <p className={styles.category}>{CUSTOMER_CATEGORY_LABELS[m.category]}</p>
                <h2>{m.memberName}</h2>
                <p className={styles.identifiers}>
                  {m.membershipNumber} · {m.customerNumber}
                </p>
                <p className={styles.identifiers}>
                  <TierBadge tier={m.tier} />{' '}
                  {m.mayUsePrivileges ? 'VIP privileges available' : 'VIP privileges unavailable'}
                </p>
                <dl className={styles.details}>
                  <div className={styles.fact}>
                    <div className={styles.factText}>
                      <dt>Membership status</dt>
                      <dd>
                        <StatusChip label={humanizeCode(m.membershipStatus)} />
                      </dd>
                    </div>
                  </div>
                  <div className={styles.fact}>
                    <div className={styles.factText}>
                      <dt>Activated</dt>
                      <dd>{m.activatedAt?.slice(0, 10) ?? 'Not activated'}</dd>
                    </div>
                  </div>
                  <div className={styles.fact}>
                    <div className={styles.factText}>
                      <dt>Valid until</dt>
                      <dd>{m.expiresAt?.slice(0, 10) ?? 'Not available'}</dd>
                    </div>
                  </div>
                  <div className={styles.fact}>
                    <div className={styles.factText}>
                      <dt>Available points</dt>
                      <dd className={styles.points}>{formatAvailablePoints(m.availablePoints)}</dd>
                    </div>
                  </div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
      {/* A refetch in flight keeps the current card mounted (placeholderData);
          the search control still announces the background update. */}
      {activeTerm.length >= 2 && !members.isPending && members.isFetching ? (
        <Skeleton style={{ height: 8 }} aria-hidden="true" />
      ) : null}
    </section>
  );
}

/**
 * Exact-decimal points for display. The figure can exceed the safe integer
 * range, so it is grouped as BigInt text, never rounded through Number.
 */
function formatAvailablePoints(value: string): string {
  try {
    return BigInt(value).toLocaleString('en-PH');
  } catch {
    return '—';
  }
}

/**
 * Actionable lookup-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeMemberLookupError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFhomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot look up members right now. Contact an administrator.';
  return undefined;
}
