import { useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  customerLookupSchema,
  CUSTOMER_CATEGORY_LABELS,
  type CustomerLookup,
} from '@afhomes/contracts';
import { PageHeader, SearchField, ErrorState, EmptyState, StatusChip, Icon } from '@afhomes/ui';
import styles from './MemberLookupPage.module.css';
import { requestList } from '../../lib/api/client';
import { ApiError, ApiNetworkError } from '../../lib/api/errors';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { TierBadge } from '../business/TierBadge';
import { tierArtwork } from '@afhomes/ui';

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
 *
 * Search is live, but in two stages: typing only ever fills the suggestion
 * list (matching names, or "Customer does not exist" when nothing matches).
 * The record card below renders solely for a *picked* suggestion — typing
 * alone never puts a card on screen, and typing on after a pick clears it.
 * There is deliberately no Search button to click.
 */

type TierKey = 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE';

/** Card theme key from the lookup tier. Anything unrecognised is cardless. */
function tierKey(tier: string | null): TierKey {
  const normalized = (tier ?? '').trim().toUpperCase();
  if (normalized === 'GOLD' || normalized === 'SILVER' || normalized === 'BRONZE') {
    return normalized;
  }
  return 'NONE';
}

/** How many name suggestions the dropdown shows at most. */
const MAX_SUGGESTIONS = 6;

/**
 * Name suggestions for the typed letters, ranked prefix-first.
 *
 * The source is the latest fetched lookup page — NOT a second endpoint — so
 * suggestions appear instantly from what is already on hand (including while
 * the next keystroke's fetch is still in flight) and cost zero extra network.
 * Only display-safe fields feed the rows: names, categories and tiers. Codes
 * match behind the scenes but are never printed here; the full identifiers
 * stay on the result cards below.
 */
function rankSuggestions(rows: CustomerLookup[], term: string): CustomerLookup[] {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];
  const starts: CustomerLookup[] = [];
  const contains: CustomerLookup[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.customerNumber)) continue;
    const matches =
      row.fullName.toLowerCase().includes(needle) ||
      row.customerNumber.toLowerCase().includes(needle) ||
      (row.customerCode ?? '').toLowerCase().includes(needle);
    if (!matches) continue;
    seen.add(row.customerNumber);
    (row.fullName.toLowerCase().startsWith(needle) ? starts : contains).push(row);
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/** Bolds the typed letters inside a suggested name. Presentation only. */
function HighlightedName({ name, term }: { name: string; term: string }) {
  const needle = term.trim().toLowerCase();
  const index = needle ? name.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, index)}
      <mark className={styles.mark}>{name.slice(index, index + needle.length)}</mark>
      {name.slice(index + needle.length)}
    </>
  );
}

function CustomerCard({ customer }: { customer: CustomerLookup }) {
  const tier = tierKey(customer.tier);
  const artwork = tier === 'NONE' ? null : tierArtwork(tier);
  const categoryLabel = CUSTOMER_CATEGORY_LABELS[customer.category];
  return (
    <article className={styles.member} data-tier={tier} aria-label={customer.fullName}>
      <div className={styles.artWrap} aria-hidden={artwork ? undefined : true}>
        {artwork ? (
          <img className={styles.art} src={artwork.src} alt={artwork.alt} loading="lazy" />
        ) : (
          <div className={styles.artPlaceholder}>
            <Icon name="user" size={28} />
            <span>No card on file</span>
          </div>
        )}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.category}>{categoryLabel}</p>
        <h2>{customer.fullName}</h2>
        <p className={styles.identifiers}>
          {customer.customerNumber}
          {customer.customerCode ? ` · ${customer.customerCode}` : ''}
        </p>
        <dl className={styles.details}>
          <div className={styles.fact}>
            <span className={styles.factIcon} aria-hidden="true">
              <Icon name="user-check" size={16} />
            </span>
            <div className={styles.factText}>
              <dt>Customer Status</dt>
              <dd>
                <StatusChip label={humanizeCode(customer.customerStatus)} />
              </dd>
            </div>
          </div>
          <div className={styles.fact}>
            <span className={styles.factIcon} aria-hidden="true">
              <Icon name="image" size={16} />
            </span>
            <div className={styles.factText}>
              <dt>VIP Tier</dt>
              <dd>
                {customer.tier ? (
                  <TierBadge tier={customer.tier} />
                ) : (
                  'None'
                )}
              </dd>
            </div>
          </div>
          <div className={styles.fact}>
            <span className={styles.factIcon} aria-hidden="true">
              <Icon name="clock" size={16} />
            </span>
            <div className={styles.factText}>
              <dt>Validity</dt>
              <dd>{customer.membershipExpiresAt?.slice(0, 10) ?? 'Not applicable'}</dd>
            </div>
          </div>
          <div className={styles.fact}>
            <span className={styles.factIcon} aria-hidden="true">
              <Icon name="user" size={16} />
            </span>
            <div className={styles.factText}>
              <dt>Membership Status</dt>
              <dd>{customer.membershipStatus ? humanizeCode(customer.membershipStatus) : 'None'}</dd>
            </div>
          </div>
        </dl>
      </div>
    </article>
  );
}

function LookupSkeleton() {
  // Placeholder while the lookup search resolves.
  return (
    <div
      className={styles.results}
      role="status"
      aria-label="Looking for Customer"
      aria-busy="true"
    >
      {[0].map((index) => (
        <div className={styles.member} data-tier="NONE" aria-hidden="true" key={index}>
          <div className={styles.artWrap}>
            <div className={styles.artSkeleton} />
          </div>
          <div className={styles.cardBody}>
            <span className={styles.skeletonChip} style={{ width: '8rem' }} />
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
  );
}

export function CustomerLookupPage() {
  const [search, setSearch] = useState('');
  const debouncedTerm = useDebouncedValue(search.trim());
  const activeTerm = debouncedTerm.length >= 2 ? debouncedTerm : '';
  const customers = useQuery({
    queryKey: membershipKeys.customerLookup(activeTerm),
    enabled: activeTerm.length >= 2,
    queryFn: () =>
      requestList(
        '/memberships/customer-lookup?search=' + encodeURIComponent(activeTerm),
        customerLookupSchema,
      ),
    // Keep the previous page on screen while the next keystroke's fetch runs:
    // refetches then feel instant (stale results + busy indicator) and the
    // skeleton only ever appears on the very first search.
    placeholderData: (previousData) => previousData,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Suggestion dropdown: names matching the RAW keystrokes, ranked from the
  // latest fetched page, so the list reacts before the debounced fetch lands.
  const term = search.trim();
  const suggestions = useMemo(
    () => rankSuggestions(customers.data ?? [], term),
    [customers.data, term],
  );
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-suggest-${index}`;
  const listOpen = suggestOpen && term.length >= 2;
  // The debounced term actually sent to the server. The dropdown reacts to
  // raw keystrokes; the cards below only ever render a committed pick.
  const hasSearched = activeTerm.length >= 2;
  const dropdownVisible = listOpen && !customers.isError;
  const activeId =
    dropdownVisible && activeIndex >= 0 && suggestions[activeIndex]
      ? optionId(activeIndex)
      : undefined;

  // The picked record number. The card resolves live from the latest
  // fetched page, so a 30s refetch refreshes the shown card too.
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const selectedLookup =
    (customers.data ?? []).find((row) => row.customerNumber === selectedNumber) ?? null;

  const pickSuggestion = (row: CustomerLookup) => {
    setSearch(row.fullName);
    setSelectedNumber(row.customerNumber);
    setActiveIndex(-1);
    setSuggestOpen(false);
  };

  const onSuggestKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!suggestOpen) {
        setSuggestOpen(true);
        setActiveIndex(-1);
        return;
      }
      if (suggestions.length === 0) return;
      setActiveIndex((current) => {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        return (current + step + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      // An explicit highlight wins; otherwise Enter takes the top match, so
      // the keyboard never dead-ends on a full suggestion list.
      const row =
        suggestOpen && activeIndex >= 0 && suggestions[activeIndex]
          ? suggestions[activeIndex]
          : suggestOpen && activeIndex < 0 && suggestions[0]
            ? suggestions[0]
            : undefined;
      if (row) {
        event.preventDefault();
        pickSuggestion(row);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (!suggestOpen) return;
      event.preventDefault();
      setActiveIndex(-1);
      setSuggestOpen(false);
    }
  };

  return (
    <section className={styles.page}>
      <PageHeader title="Membership Lookup" description="Find any customer or member." />
      <div className={styles.search}>
        <div
          className={styles.suggestWrap}
          ref={wrapRef}
          onFocus={() => setSuggestOpen(true)}
          onBlur={(event) => {
            // Option rows never take focus (pointerdown is intercepted), so a
            // blur means focus truly left the search box: shut the list.
            if (!wrapRef.current?.contains(event.relatedTarget as Node)) {
              setActiveIndex(-1);
              setSuggestOpen(false);
            }
          }}
        >
          <SearchField
            size="lg"
            busy={customers.isFetching && activeTerm.length >= 2}
            label="Find customer"
            placeholder="Customer ID, Customer Code, or name"
            value={search}
            onChange={(value) => {
              setSearch(value);
              // Typing on unpicks: the card below belongs to the last pick.
              setSelectedNumber(null);
              setActiveIndex(-1);
              setSuggestOpen(true);
            }}
            combobox={{
              expanded: dropdownVisible,
              controlsId: listId,
              activeOptionId: activeId,
              onKeyDown: onSuggestKeyDown,
            }}
          />
          {dropdownVisible ? (
            <ul
              className={styles.suggestList}
              id={listId}
              role="listbox"
              aria-label="Name suggestions"
            >
              {customers.isPending && suggestions.length === 0 ? (
                [0, 1, 2].map((index) => (
                  <li
                    className={styles.suggestOption}
                    role="presentation"
                    aria-hidden="true"
                    key={index}
                  >
                    <span className={styles.skeletonLine} style={{ width: '55%', height: 18 }} />
                    <span className={styles.skeletonLine} style={{ width: '5rem' }} />
                  </li>
                ))
              ) : suggestions.length === 0 ? (
                <li className={styles.suggestHint} role="presentation">
                  Customer does not exist
                </li>
              ) : (
                suggestions.map((row, index) => (
                  <li
                    key={row.customerNumber}
                    id={optionId(index)}
                    className={styles.suggestOption}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-active={index === activeIndex ? 'true' : 'false'}
                    onMouseDown={(event) => {
                      // Land the pick before blur shuts the list.
                      event.preventDefault();
                      pickSuggestion(row);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className={styles.suggestName}>
                      <HighlightedName name={row.fullName} term={term} />
                    </span>
                    <span className={styles.suggestMeta}>
                      {CUSTOMER_CATEGORY_LABELS[row.category]}
                      {row.tier ? ` · ${row.tier}` : ''}
                    </span>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </div>
      {term.length < 2 ? (
        <EmptyState title="Enter at least two characters to find a customer or member" />
      ) : selectedLookup ? (
        <div className={styles.results}>
          <CustomerCard key={selectedLookup.customerNumber} customer={selectedLookup} />
        </div>
      ) : !hasSearched ? null : customers.isPending ? (
        <LookupSkeleton />
      ) : customers.isError ? (
        <ErrorState
          error={customers.error}
          title="Customer lookup is unavailable right now"
          message={describeCustomerLookupError(customers.error)}
          onRetry={() => void customers.refetch()}
        />
      ) : customers.data?.length === 0 ? (
        <EmptyState
          title="Customer does not exist"
          description="Check the spelling and try different letters."
        />
      ) : (
        <EmptyState title="Select a suggested name to view the record." />
      )}
    </section>
  );
}

/**
 * Actionable lookup-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describeCustomerLookupError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot look up customers right now. Contact an administrator.';
  return undefined;
}
