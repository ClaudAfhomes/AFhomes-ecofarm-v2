import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { EmptyState, ErrorState, Icon, PageHeader, Skeleton, StatusChip } from '@jad/ui';
import type { GenealogyNode, MemberStatus } from '@jad/contracts';

import { ButtonLink } from '@/components/ButtonLink';
import { orphanMessageFor } from '../../../lib/api/orphan';
import { useGenealogy } from '../hooks/useMember';
import { MEMBER_STATUS_TONE, formatDate, memberStatusLabel } from '../lib/presentation';
import styles from './MyGenealogyPage.module.css';

type StatusFilter = 'ALL' | MemberStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'APPROVED_ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** Filtered tree keeps a node when it matches the filter OR has matching descendants. */
function filteredTree(node: GenealogyNode, filter: StatusFilter): GenealogyNode | null {
  const children = node.children
    .map((child) => filteredTree(child, filter))
    .filter((child): child is GenealogyNode => child !== null);
  const selfMatches = filter === 'ALL' || node.status === filter;
  if (!selfMatches && children.length === 0) return null;
  return { ...node, children };
}

function countNodes(node: GenealogyNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** Up to two leading initials for the decorative avatar circle ("Juan Dela Cruz" → "JD"). */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}

interface BranchProps {
  node: GenealogyNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
  forceExpanded?: boolean;
}

/**
 * A genealogy tree branch - one node (the member + their direct referrals,
 * recursively). Expand/collapse per node; never shows or computes multi-level
 * commission (BI-004, BR-RPT-004). The mock tree is small; for large trees the
 * list must be virtualized (UI-UX §11.4) before real API rollout.
 */
function GenealogyBranch({ node, collapsed, onToggle, depth, forceExpanded }: BranchProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = forceExpanded || !collapsed.has(node.id);
  const indent = Math.min(depth * varUnit, 64);

  return (
    <li className={styles.branch}>
      <div className={styles.node} style={{ marginLeft: `${indent}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
            onClick={() => onToggle(node.id)}
          >
            <Icon
              name="chevron-down"
              size={16}
              className={styles.chevron}
              style={isExpanded ? { transform: 'rotate(0deg)' } : { transform: 'rotate(-90deg)' }}
            />
          </button>
        ) : (
          <span className={styles.leafDot} aria-hidden="true" />
        )}
        <span className={styles.avatar} aria-hidden="true">
          {initials(node.name)}
        </span>
        <span className={styles.nodeMain}>
          <span className={styles.nodeName}>{node.name}</span>
          <span className={styles.nodeMeta}>joined {formatDate(node.joinedAt)}</span>
        </span>
        <span className={styles.chipGroup}>
          <StatusChip
            label={node.isQualified ? 'Qualified' : 'Not qualified'}
            tone={node.isQualified ? 'success' : 'neutral'}
          />
          <StatusChip
            label={memberStatusLabel(node.status)}
            tone={MEMBER_STATUS_TONE[node.status as MemberStatus]}
          />
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <ul className={styles.children}>
          {node.children.map((child) => (
            <GenealogyBranch
              key={child.id}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              depth={depth + 1}
              forceExpanded={forceExpanded}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** CSS custom property indentation is computed in px units here to keep depth spacing simple. */
const varUnit = 24;

/**
 * My Genealogy (SCR-MEM-018, FR-RPT-004). Tree visualization of referral
 * relationships - reporting only, no MLM implication (BI-004). Supports
 * expand/collapse and filtering by member status; jumps to the Direct Referrals
 * list (primary actions, UI-UX SCR-MEM-018).
 */
export function MyGenealogyPage() {
  const genealogyQuery = useGenealogy();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const root = genealogyQuery.data?.root;
  const visibleRoot = useMemo(() => (root ? filteredTree(root, filter) : null), [root, filter]);
  const visibleCount = useMemo(
    () => (visibleRoot ? countNodes(visibleRoot) - 1 : 0),
    [visibleRoot],
  );

  useEffect(() => {
    if (root) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- default-collapses direct children after tree loads
      setCollapsed(new Set(root.children.map((child) => child.id)));
    }
  }, [root]);

  const onToggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section>
      <PageHeader
        title="My Genealogy"
        description="Your referral tree - a reporting view, not a commission structure."
        actions={
          <div className={styles.headerActions}>
            <ButtonLink to="/member/referrals/direct" variant="secondary">
              View Direct Referrals
            </ButtonLink>
            <ButtonLink to="/member/referrals/earned" variant="ghost">
              View Total Earned
            </ButtonLink>
          </div>
        }
      />

      {genealogyQuery.data ? (
        <div className={styles.sponsor}>
          <h2 className={styles.sponsorTitle}>Sponsorship</h2>
          {genealogyQuery.data.sponsor ? (
            <>
              <p className={styles.sponsorIntro}>
                Sponsored by <strong>{genealogyQuery.data.sponsor.name}</strong>
              </p>
              <ol className={styles.chain} aria-label="Your sponsor chain">
                {genealogyQuery.data.ancestors.map((node) => (
                  <li key={node.id} className={styles.chainStep}>
                    <span className={styles.chainAvatar} aria-hidden="true">
                      {initials(node.name)}
                    </span>
                    <span className={styles.chainName}>{node.name}</span>
                  </li>
                ))}
                <li className={styles.chainStepCurrent}>
                  <span className={styles.chainAvatar} aria-hidden="true">
                    {initials(genealogyQuery.data.root.name)}
                  </span>
                  <span className={styles.chainName}>
                    {genealogyQuery.data.root.name} <span className={styles.chainYou}>(you)</span>
                  </span>
                </li>
              </ol>
            </>
          ) : (
            <p className={styles.sponsorNone}>No sponsor linked to your account yet.</p>
          )}
        </div>
      ) : null}

      <div className={styles.filters} role="group" aria-label="Filter genealogy by status">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={filter === option.value ? styles.filterActive : styles.filter}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className={styles.count} aria-live="polite">
        {genealogyQuery.isLoading
          ? 'Loading genealogy…'
          : visibleRoot
            ? `Showing ${visibleCount} member${visibleCount === 1 ? '' : 's'}${filter !== 'ALL' ? ` · filtered by ${filter}` : ''}`
            : 'No matching members'}
      </p>

      {genealogyQuery.isLoading ? (
        <div className={styles.loading} role="status">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : genealogyQuery.isError ? (
        <ErrorState
          error={genealogyQuery.error}
          title="Could not load your genealogy"
          message={orphanMessageFor(genealogyQuery.error)}
          onRetry={() => void genealogyQuery.refetch()}
        />
      ) : !visibleRoot ? (
        <EmptyState
          title="No matching members"
          description="No members match this filter. Try another status or clear the filter."
          action={
            <button type="button" className={styles.inlineLink} onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          }
        />
      ) : visibleRoot.children.length === 0 ? (
        <EmptyState
          title="No referrals in your tree"
          description="Members who join with your referral code appear here."
          action={
            <Link className={styles.inlineLink} to="/member/referrals">
              View your referral code
            </Link>
          }
        />
      ) : (
        <ul className={styles.tree}>
          <GenealogyBranch
            node={visibleRoot}
            collapsed={collapsed}
            onToggle={onToggle}
            depth={0}
            forceExpanded={filter !== 'ALL'}
          />
        </ul>
      )}

      <p className={styles.note}>
        Your genealogy is for reporting only. Referral commissions are strictly single-level and
        never extend down this tree (BR-RPT-004).
      </p>
    </section>
  );
}
