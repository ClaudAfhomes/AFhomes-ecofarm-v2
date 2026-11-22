import { useCallback, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  notifyError,
  notifySuccess,
  type StatusTone,
} from '@afhomes/ui';
import type { Inquiry, InquiryStatus, UpdateInquiryInput } from '@afhomes/contracts';

import { formatDate, formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { listInquiries, updateInquiry } from './services';
import styles from '../reports/AuditPage.module.css';

const PAGE_SIZE = 50;

const STATUS: Record<InquiryStatus, { label: string; tone: StatusTone }> = {
  new: { label: 'New', tone: 'warning' },
  contacted: { label: 'Contacted', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  spam: { label: 'Spam', tone: 'danger' },
};

/** The one next step for a record, so the list needs a single click per lead. */
export function nextStep(inquiry: Pick<Inquiry, 'status' | 'kind'>): {
  label: string;
  status: InquiryStatus;
} {
  switch (inquiry.status) {
    case 'new':
      return { label: 'Mark contacted', status: 'contacted' };
    case 'contacted':
      return inquiry.kind === 'reservation'
        ? { label: 'Mark confirmed', status: 'confirmed' }
        : { label: 'Close', status: 'closed' };
    case 'confirmed':
      return { label: 'Close', status: 'closed' };
    default:
      return { label: 'Reopen', status: 'contacted' };
  }
}

const visitSummary = (i: Pick<Inquiry, 'visitDate' | 'endDate' | 'guests'>) =>
  i.visitDate
    ? `${formatDate(i.visitDate)}${i.endDate && i.endDate !== i.visitDate ? ` – ${formatDate(i.endDate)}` : ''}${i.guests ? ` · ${i.guests} guest${i.guests === 1 ? '' : 's'}` : ''}`
    : '—';

/**
 * Website Inquiries. The website contact and reservation-request form lands
 * here (`POST /inquiries`, no sign-in). Reading needs `sales.inquiries` view;
 * every change needs update and is audited server-side. A reservation request
 * is a lead to call back, not a booking.
 */
export function InquiriesPage() {
  const queryClient = useQueryClient();
  const mayUpdate =
    useSession().user?.afHomesPermissions?.find((p) => p.moduleKey === 'sales.inquiries')
      ?.canUpdate === true;
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const resetPage = useCallback(() => setOffset(0), []);
  const debouncedSearch = useDebouncedValue(search, 300, resetPage);

  const query = useQuery({
    queryKey: ['inquiries', status, kind, debouncedSearch, offset],
    queryFn: () =>
      listInquiries({
        status: status as 'open',
        ...(kind ? { kind: kind as 'inquiry' } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateInquiryInput }) => updateInquiry(id, input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      notifySuccess({
        title: 'Inquiry updated',
        message: `${saved.reference} is ${STATUS[saved.status].label.toLowerCase()}.`,
      });
    },
    onError: (error) =>
      notifyError({
        title: 'Inquiry not updated',
        message: error instanceof Error ? error.message : 'Try again.',
      }),
  });

  const openInquiry = query.data?.data.find((i) => i.id === openId);
  const open = (inquiry: Inquiry) => {
    setOpenId(inquiry.id);
    setNotes(inquiry.staffNotes);
  };
  const save = (inquiry: Inquiry, input: UpdateInquiryInput) =>
    mutation.mutate({ id: inquiry.id, input });

  if (query.isPending)
    return (
      <section className={styles.page}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }} role="status" aria-label="Loading inquiries">
          <Skeleton style={{ height: 32, maxWidth: 240 }} />
          <Skeleton style={{ height: 40, maxWidth: 420 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      </section>
    );

  const total = query.data?.total ?? 0;
  const newCount = query.data?.newCount ?? 0;

  return (
    <section className={styles.page}>
      <PageHeader
        title="Website Inquiries"
        description="Messages and reservation requests sent from the website. Call or email the person back, then move the inquiry to its next step. A reservation request does not hold a room until you confirm it with them."
      />

      <FilterBar
        search={
          <SearchField
            label="Search"
            placeholder="Name, email, phone or INQ number"
            value={search}
            onChange={setSearch}
            busy={query.isFetching && !query.isPending}
          />
        }
        filters={
          <>
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
              options={[
                { value: 'open', label: 'Open (new, contacted, confirmed)' },
                { value: 'new', label: 'New' },
                { value: 'contacted', label: 'Contacted' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'closed', label: 'Closed' },
                { value: 'spam', label: 'Spam' },
                { value: 'all', label: 'All' },
              ]}
            />
            <Select
              aria-label="Type"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                resetPage();
              }}
              options={[
                { value: '', label: 'Inquiries and reservations' },
                { value: 'inquiry', label: 'Inquiries only' },
                { value: 'reservation', label: 'Reservation requests only' },
              ]}
            />
          </>
        }
      />
      <div className={styles.resultBar} aria-live="polite">
        <span>
          {`${total.toLocaleString()} inquir${total === 1 ? 'y' : 'ies'}`}
          {newCount > 0 ? ` · ${newCount} new waiting for a reply` : ''}
        </span>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data || query.data.data.length === 0 ? (
        <EmptyState
          title={status === 'open' ? 'No open inquiries' : 'No inquiries'}
          description={
            status === 'open'
              ? 'New messages from the website contact form appear here.'
              : 'Nothing matches these filters.'
          }
        />
      ) : (
        <>
          <div role="region" aria-label="Scrollable records" tabIndex={0} className={`table-scroll ${styles.tableWrap}`}>
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>From</th>
                  <th>About</th>
                  <th>Visit</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((inquiry) => {
                  const step = nextStep(inquiry);
                  return (
                    <tr key={inquiry.id}>
                      <td data-label="Received">
                        <span className={styles.actor}>
                          <span>{formatDateTime(inquiry.createdAt)}</span>
                          <small>{inquiry.reference}</small>
                        </span>
                      </td>
                      <td data-label="From">
                        <span className={styles.actor}>
                          <span>{inquiry.name}</span>
                          <small>{inquiry.contactNumber}</small>
                        </span>
                      </td>
                      <td data-label="About">
                        <span className={styles.actor}>
                          <span>{inquiry.inquiryType}</span>
                          <small>{inquiry.kind === 'reservation' ? 'Reservation request' : 'Inquiry'}</small>
                        </span>
                      </td>
                      <td data-label="Visit">{visitSummary(inquiry)}</td>
                      <td data-label="Status">
                        <span className={styles.actor}>
                          <StatusChip label={STATUS[inquiry.status].label} tone={STATUS[inquiry.status].tone} />
                          {inquiry.assignedToName ? <small>{inquiry.assignedToName}</small> : null}
                        </span>
                      </td>
                      <td data-label="">
                        <span style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                          {mayUpdate ? (
                            <Button
                              size="sm"
                              disabled={mutation.isPending}
                              onClick={() => save(inquiry, { status: step.status })}
                            >
                              {step.label}
                            </Button>
                          ) : null}
                          <Button size="sm" variant="secondary" onClick={() => open(inquiry)}>
                            Details
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.actionsRow}>
            <span className={styles.range}>
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button variant="secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={Boolean(openInquiry)}
        onClose={() => setOpenId(null)}
        title={openInquiry ? `${openInquiry.reference} · ${openInquiry.name}` : 'Inquiry'}
        footer={
          openInquiry ? (
            <>
              {mayUpdate && openInquiry.status !== 'spam' ? (
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => save(openInquiry, { status: 'spam' })}
                >
                  Mark as spam
                </Button>
              ) : null}
              {mayUpdate ? (
                <Button
                  variant="secondary"
                  disabled={mutation.isPending || notes === openInquiry.staffNotes}
                  onClick={() => save(openInquiry, { staffNotes: notes })}
                >
                  Save notes
                </Button>
              ) : null}
              {mayUpdate ? (
                <Button
                  disabled={mutation.isPending}
                  onClick={() => save(openInquiry, { status: nextStep(openInquiry).status })}
                >
                  {nextStep(openInquiry).label}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setOpenId(null)}>
                  Close
                </Button>
              )}
            </>
          ) : null
        }
      >
        {openInquiry ? (
          <div className={styles.detailSection}>
            <dl className={styles.facts}>
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${openInquiry.email}?subject=${encodeURIComponent(`AF Homes ${openInquiry.reference}`)}`}>
                    {openInquiry.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${openInquiry.contactNumber.replace(/[^+\d]/g, '')}`}>{openInquiry.contactNumber}</a>
                </dd>
              </div>
              <div>
                <dt>About</dt>
                <dd>
                  {openInquiry.inquiryType}
                  <small>{openInquiry.kind === 'reservation' ? 'Reservation request' : 'Inquiry'}</small>
                </dd>
              </div>
              <div>
                <dt>Visit</dt>
                <dd>{visitSummary(openInquiry)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {STATUS[openInquiry.status].label}
                  <small>{openInquiry.assignedToName ? `Handled by ${openInquiry.assignedToName}` : 'Not assigned'}</small>
                </dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{formatDateTime(openInquiry.createdAt)}</dd>
              </div>
            </dl>
            <div>
              <h3 className={styles.changesTitle}>Message</h3>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 'var(--space-2) 0 0' }}>
                {openInquiry.message}
              </p>
            </div>
            {mayUpdate ? (
              <>
                <TextAreaField
                  id="inquiry-notes"
                  name="staffNotes"
                  label="Staff notes"
                  optional
                  hint="Only staff see these. Not sent to the person."
                  rows={3}
                  maxLength={5000}
                  value={notes}
                  onChange={setNotes}
                />
                {openInquiry.assignedTo ? null : (
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={mutation.isPending}
                      onClick={() => save(openInquiry, { assignToMe: true })}
                    >
                      Assign to me
                    </Button>
                  </div>
                )}
              </>
            ) : openInquiry.staffNotes ? (
              <p className={styles.muted}>Notes: {openInquiry.staffNotes}</p>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
