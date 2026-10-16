import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import { MEMBER_POSITION_LABELS, type MemberPosition } from '@afhomes/contracts';
import { formatCountOrDash } from '@afhomes/shared';
import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { CreateMemberDialog } from './CreateMemberDialog';
import { MemberDetailDialog } from './MemberDetailDialog';
import { getMembers, networkMemberKeys } from './services';
import styles from './MembersPage.module.css';

const PAGE_SIZE = 10;

const POSITIONS: readonly MemberPosition[] = [
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
];

/**
 * Sales-network Members: hierarchy sellers and OSTs onboarded with a full
 * personal record. Creating a member provisions the staff login and the AA
 * number; accreditation dates stay visible in the sale-team desk.
 */
export function MembersPage() {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<'all' | MemberPosition>('all');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const settled = useDebouncedValue(search.trim(), 300, () => setPage(0));
  const query = useQuery({
    queryKey: networkMemberKeys.list(settled, position),
    queryFn: () => getMembers({ search: settled, position: position === 'all' ? undefined : position }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const rows = query.data ?? [];
  // The open record reads from the list, so a refetch (an issue, a save, the
  // 30s poll) updates the dialog instead of leaving a stale snapshot.
  const viewing = viewingId ? (rows.find((member) => member.id === viewingId) ?? null) : null;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const active = rows.filter((member) => member.status === 'active').length;
  const filtersActive = search !== '' || position !== 'all';

  if (query.isPending) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading members"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 260 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <Skeleton style={{ height: 40, maxWidth: 420 }} />
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading members…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="Members"
        description="Hierarchy sellers and OSTs with their heads."
        actions={<Button onClick={() => setCreateOpen(true)}>Create Member</Button>}
      />
      <div className={styles.badges} aria-label="Member summary">
        <StatusChip label={`Listed members: ${formatCountOrDash(rows.length)}`} tone="neutral" />
        <StatusChip label={`Active members: ${formatCountOrDash(active)}`} tone="success" />
      </div>
      <FilterBar
        search={
          <SearchField
            label="Search members"
            placeholder="Name, email, or code"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            busy={query.isFetching}
          />
        }
        filters={
          <>
            <Select
              aria-label="Filter position"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value as 'all' | MemberPosition);
                setPage(0);
              }}
              options={[
                { value: 'all', label: 'All positions' },
                ...POSITIONS.map((value) => ({
                  value,
                  label: MEMBER_POSITION_LABELS[value],
                })),
              ]}
            />
            {filtersActive ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setPosition('all');
                  setPage(0);
                }}
              >
                Clear
              </Button>
            ) : null}
          </>
        }
      />
      {query.isError ? (
        <ErrorState
          error={query.error}
          title="Members could not be loaded"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No matching records.' : 'No members'}
          description={
            filtersActive
              ? 'No members match these filters.'
              : 'Create Member provisions the staff login.'
          }
          action={
            filtersActive ? undefined : (
              <Button onClick={() => setCreateOpen(true)}>Create Member</Button>
            )
          }
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Position</TableHeaderCell>
                  <TableHeaderCell>AA Number</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Added</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((member) => (
                  <TableRow
                    key={member.id}
                    className={styles.clickable}
                    onClick={() => setViewingId(member.id)}
                  >
                    <TableCell label="Code">
                      <span
                        className={
                          member.employeeNumber
                            ? styles.codeChip
                            : `${styles.codeChip} ${styles.codeEmpty}`
                        }
                      >
                        {member.employeeNumber ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell label="Name">
                      <span className={styles.identityCell}>
                        <span className={styles.identityAvatar} aria-hidden="true">
                          {(member.fullName.trim().charAt(0) || '-').toUpperCase()}
                        </span>
                        <span>
                          <span className={styles.identityName}>{member.fullName}</span>
                          <small className={styles.identityMeta}>{member.email}</small>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell label="Position">
                      <StatusChip label={member.positionLabel} tone="neutral" />
                    </TableCell>
                    <TableCell label="AA Number">
                      <span className={styles.codeCell}>{member.aaNumber ?? '—'}</span>
                    </TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={member.status}
                        tone={member.status === 'active' ? 'success' : 'neutral'}
                      />
                    </TableCell>
                    <TableCell label="Added">{formatDateTime(member.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={styles.pagination}>
            <Pagination
              page={safePage + 1}
              pageCount={pageCount}
              onChange={(next) => setPage(next - 1)}
              label="Members pagination"
            />
          </div>
        </>
      )}
      <CreateMemberDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
        }}
      />
      {viewing ? (
        <MemberDetailDialog
          member={viewing}
          onClose={() => setViewingId(null)}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
          }}
        />
      ) : null}
    </section>
  );
}
