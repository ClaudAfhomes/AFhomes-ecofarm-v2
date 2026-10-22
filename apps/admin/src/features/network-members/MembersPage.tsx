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
  Spinner,
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
import { MemberWorkbookDialog } from './MemberWorkbookDialog';
import { CreateOstDialog } from './CreateOstDialog';
import { MemberDetailDialog } from './MemberDetailDialog';
import { TransferMemberDialog } from './TransferMemberDialog';
import { TransferToIstDialog } from './TransferToIstDialog';
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
  const [workbookOpen, setWorkbookOpen] = useState(false);
  const [createOstOpen, setCreateOstOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [convertToIstId, setConvertToIstId] = useState<string | null>(null);
  const settled = useDebouncedValue(search.trim(), 300, () => setPage(0));
  const query = useQuery({
    queryKey: networkMemberKeys.list(settled, position),
    queryFn: () =>
      getMembers({ search: settled, position: position === 'all' ? undefined : position }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const rows = query.data ?? [];
  // The open record reads from the list, so a refetch (an issue, a save, the
  // 30s poll) updates the dialog instead of leaving a stale snapshot.
  const viewing = viewingId ? (rows.find((member) => member.id === viewingId) ?? null) : null;
  const transferring = transferId
    ? (rows.find((member) => member.id === transferId) ?? null)
    : null;
  const convertingToIst = convertToIstId
    ? (rows.find((member) => member.id === convertToIstId) ?? null)
    : null;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Determine if a member row should be clickable based on detailAuthorized flag
  // For upline name-only records, detailAuthorized is false
  const isClickable = (member: typeof rows[0]) => member.detailAuthorized === true;
  const active = rows.filter((member) => member.status === 'active').length;
  const filtersActive = search !== '' || position !== 'all';
  const rangeStart = rows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min((safePage + 1) * PAGE_SIZE, rows.length);

  // The skeleton mirrors the real layout (header, summary chips, filters,
  // table rows) so the page does not jump when the data lands.
  if (query.isPending) {
    return (
      <section className={styles.page}>
        <div className={styles.loadingStack} role="status" aria-label="Loading members">
          <div className={styles.loadingHeader}>
            <div className={styles.loadingHeaderText}>
              <Skeleton className={styles.loadingTitle} />
              <Skeleton className={styles.loadingSubtitle} />
            </div>
            <Skeleton className={styles.loadingAction} />
          </div>
          <div className={styles.loadingChips}>
            <Skeleton className={styles.loadingChip} />
            <Skeleton className={styles.loadingChip} />
          </div>
          <div className={styles.loadingFilters}>
            <Skeleton className={styles.loadingSearch} />
            <Skeleton className={styles.loadingSelect} />
          </div>
          <div className={styles.loadingTable}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className={styles.loadingRow}>
                <Skeleton className={styles.loadingAvatar} />
                <Skeleton className={styles.loadingLineLong} />
                <Skeleton className={styles.loadingLineShort} />
              </div>
            ))}
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
        description="Sales-network members. Click a row to view details."
        actions={
          <>
            <Button variant="secondary" onClick={() => setWorkbookOpen(true)}>Import / export</Button>
            <Button variant="secondary" onClick={() => setCreateOstOpen(true)}>
              Create OST
            </Button>
            <Button onClick={() => setCreateOpen(true)}>Create IST</Button>
          </>
        }
      />
      <div className={styles.badges} aria-label="Member summary">
        <StatusChip label={`Listed members: ${formatCountOrDash(rows.length)}`} tone="neutral" />
        <StatusChip label={`Active members: ${formatCountOrDash(active)}`} tone="success" />
        {query.isFetching && !query.isPending ? (
          <span className={styles.refreshing} role="status">
            <Spinner size="sm" />
            Updating…
          </span>
        ) : null}
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
              : 'Create IST provisions the staff login and its AA number; Create OST starts an OST registration.'
          }
          action={
            filtersActive ? undefined : (
              <Button onClick={() => setCreateOpen(true)}>Create IST</Button>
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
                {visible.map((member) => {
                  const clickable = isClickable(member);
                  return (
                    <TableRow
                      key={member.id}
                      className={`${styles.clickable} ${clickable ? '' : styles.nonClickable}`}
                      onClick={clickable ? () => setViewingId(member.id) : undefined}
                      aria-disabled={!clickable}
                      tabIndex={clickable ? 0 : -1}
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
                  );
                })}
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
            <p role="status">
              Showing {rangeStart}-{rangeEnd} of {rows.length}
            </p>
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
      <CreateOstDialog
        open={createOstOpen}
        onClose={() => setCreateOstOpen(false)}
        onCreated={() => {
          setCreateOstOpen(false);
          void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
        }}
      />
      {workbookOpen ? <MemberWorkbookDialog
        onClose={() => setWorkbookOpen(false)}
        onCreated={() => { void client.invalidateQueries({ queryKey: networkMemberKeys.scope }); }}
      /> : null}
      {viewing ? (
        <MemberDetailDialog
          member={viewing}
          onClose={() => setViewingId(null)}
          onChanged={() => {
            void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
          }}
          onTransfer={(member) => {
            // One modal at a time: the record view hands over to the transfer.
            setViewingId(null);
            setTransferId(member.id);
          }}
          onConvertToIst={(member) => {
            // The IST conversion is its own workflow, not a team move.
            setViewingId(null);
            setConvertToIstId(member.id);
          }}
        />
      ) : null}
      {transferring ? (
        <TransferMemberDialog
          member={transferring}
          onClose={() => setTransferId(null)}
          onTransferred={() => {
            setTransferId(null);
            void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
          }}
        />
      ) : null}
      {convertingToIst ? (
        <TransferToIstDialog
          member={convertingToIst}
          onClose={() => setConvertToIstId(null)}
          onTransferred={() => {
            setConvertToIstId(null);
            void client.invalidateQueries({ queryKey: networkMemberKeys.scope });
          }}
        />
      ) : null}
    </section>
  );
}