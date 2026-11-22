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
import {
  BOOKING_STATUS_LABELS,
  canTransitionBooking,
  type Booking,
  type BookingStatus,
  type UpdateBooking,
} from '@afhomes/contracts';

import { formatDate, formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { errorText, todayInManila, useModuleAccess } from './permissions';
import { listBookings, updateBooking } from './services';
import styles from '../reports/AuditPage.module.css';
import local from './Engagement.module.css';

const PAGE_SIZE = 50;

const TONE: Record<BookingStatus, StatusTone> = {
  requested: 'warning',
  confirmed: 'success',
  declined: 'danger',
  cancelled: 'neutral',
  completed: 'info',
};

export interface BookingStep {
  label: string;
  status: UpdateBooking['status'];
  /** Set when the move is impossible right now; the control is disabled and says why. */
  blockedReason?: string;
}

/**
 * The one next step for a booking. A confirmed booking can only be completed
 * once its start date has arrived, and a request for a past date can no longer
 * be confirmed; the server enforces both, this only explains them up front.
 */
export function nextStep(
  booking: Pick<Booking, 'status' | 'startDate'>,
  today: string,
): BookingStep | null {
  if (booking.status === 'requested') {
    const step: BookingStep = { label: 'Confirm', status: 'confirmed' };
    if (booking.startDate < today)
      step.blockedReason = 'The start date has passed, so this request can only be declined.';
    return step;
  }
  if (booking.status === 'confirmed' && booking.startDate <= today)
    return { label: 'Mark completed', status: 'completed' };
  return null;
}

const stay = (b: Pick<Booking, 'startDate' | 'endDate' | 'guests'>) =>
  `${formatDate(b.startDate)}${b.endDate && b.endDate !== b.startDate ? ` – ${formatDate(b.endDate)}` : ''} · ${b.guests} guest${b.guests === 1 ? '' : 's'}`;

/**
 * Service Bookings. Members request a published service for a date; staff
 * confirm or decline, then mark it completed once the date has come. Reading
 * needs `operations.bookings` view, every decision needs update and is
 * re-checked and audited server-side. The message to the member is shown in
 * their portal and emailed.
 */
export function BookingsPage() {
  const queryClient = useQueryClient();
  const { canUpdate: mayUpdate } = useModuleAccess('operations.bookings');
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const today = todayInManila();

  const resetPage = useCallback(() => setOffset(0), []);
  const debouncedSearch = useDebouncedValue(search, 300, resetPage);

  const query = useQuery({
    queryKey: ['bookings', status, debouncedSearch, offset],
    queryFn: () =>
      listBookings({
        status: status as 'open',
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBooking }) => updateBooking(id, input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-alerts'] });
      setOpenId(null);
      notifySuccess({
        title: 'Booking updated',
        message: `${saved.reference} is ${BOOKING_STATUS_LABELS[saved.status].toLowerCase()}.`,
      });
    },
    onError: (error) =>
      notifyError({ title: 'Booking not updated', message: errorText(error) }),
  });

  const openBooking = query.data?.data.find((b) => b.id === openId);
  const decide = (booking: Booking, input: UpdateBooking) =>
    mutation.mutate({ id: booking.id, input });
  const decideWithNote = (booking: Booking, next: UpdateBooking['status']) =>
    decide(booking, { status: next, ...(note.trim() ? { note: note.trim() } : {}) });

  if (query.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading bookings"
        >
          <Skeleton style={{ height: 32, maxWidth: 240 }} />
          <Skeleton style={{ height: 40, maxWidth: 420 }} />
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
        </div>
      </section>
    );

  const total = query.data?.total ?? 0;
  const requestedCount = query.data?.requestedCount ?? 0;
  const detailStep = openBooking ? nextStep(openBooking, today) : null;

  return (
    <section className={styles.page}>
      <PageHeader
        title="Service Bookings"
        description="Members request a service for a date. Confirm or decline each request, and mark it completed once the date has come. Your message to the member is shown in their portal and emailed."
      />

      <FilterBar
        search={
          <SearchField
            label="Search"
            placeholder="Member name, number or booking reference"
            value={search}
            onChange={setSearch}
            busy={query.isFetching && !query.isPending}
          />
        }
        filters={
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
            options={[
              { value: 'open', label: 'Open (requested, confirmed)' },
              { value: 'requested', label: 'Requested' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'completed', label: 'Completed' },
              { value: 'declined', label: 'Declined' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />
      <div className={styles.resultBar} aria-live="polite">
        <span>
          {`${total.toLocaleString()} booking${total === 1 ? '' : 's'}`}
          {requestedCount > 0 ? ` · ${requestedCount} waiting for a decision` : ''}
        </span>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !query.data || query.data.data.length === 0 ? (
        <EmptyState
          title={status === 'open' ? 'No open bookings' : 'No bookings'}
          description={
            status === 'open'
              ? 'Booking requests from members appear here.'
              : 'Nothing matches these filters.'
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
            <table>
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Member</th>
                  <th>Service</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {query.data.data.map((booking) => {
                  const step = nextStep(booking, today);
                  return (
                    <tr key={booking.id}>
                      <td data-label="Requested">
                        <span className={styles.actor}>
                          <span>{formatDateTime(booking.createdAt)}</span>
                          <small>{booking.reference}</small>
                        </span>
                      </td>
                      <td data-label="Member">
                        <span className={styles.actor}>
                          <span>{booking.customerName ?? '—'}</span>
                          <small>{booking.customerNumber ?? ''}</small>
                        </span>
                      </td>
                      <td data-label="Service">{booking.serviceName}</td>
                      <td data-label="Dates">{stay(booking)}</td>
                      <td data-label="Status">
                        <StatusChip
                          label={BOOKING_STATUS_LABELS[booking.status]}
                          tone={TONE[booking.status]}
                        />
                      </td>
                      <td data-label="">
                        <span className={local.rowActions}>
                          {mayUpdate && step ? (
                            <Button
                              size="sm"
                              disabled={mutation.isPending || Boolean(step.blockedReason)}
                              title={step.blockedReason}
                              onClick={() => decide(booking, { status: step.status })}
                            >
                              {step.label}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setOpenId(booking.id);
                              setNote('');
                            }}
                          >
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
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={Boolean(openBooking)}
        onClose={() => setOpenId(null)}
        title={openBooking ? `${openBooking.reference} · ${openBooking.serviceName}` : 'Booking'}
        footer={
          openBooking ? (
            <>
              {mayUpdate && canTransitionBooking(openBooking.status, 'declined') ? (
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => decideWithNote(openBooking, 'declined')}
                >
                  Decline
                </Button>
              ) : null}
              {mayUpdate && openBooking.status === 'confirmed' ? (
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => decideWithNote(openBooking, 'cancelled')}
                >
                  Cancel booking
                </Button>
              ) : null}
              {mayUpdate && detailStep ? (
                <Button
                  disabled={mutation.isPending || Boolean(detailStep.blockedReason)}
                  onClick={() => decideWithNote(openBooking, detailStep.status)}
                >
                  {detailStep.label}
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
        {openBooking ? (
          <div className={styles.detailSection}>
            <dl className={styles.facts}>
              <div>
                <dt>Member</dt>
                <dd>
                  {openBooking.customerName ?? '—'}
                  <small>{openBooking.customerNumber ?? ''}</small>
                </dd>
              </div>
              <div>
                <dt>Service</dt>
                <dd>{openBooking.serviceName}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>{stay(openBooking)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {BOOKING_STATUS_LABELS[openBooking.status]}
                  <small>
                    {openBooking.decidedByName
                      ? `Decided by ${openBooking.decidedByName}`
                      : 'Not decided yet'}
                  </small>
                </dd>
              </div>
            </dl>
            <div>
              <h3 className={styles.changesTitle}>Member notes</h3>
              <p className={local.text}>{openBooking.customerNotes || 'No notes.'}</p>
            </div>
            {openBooking.responseNote ? (
              <div>
                <h3 className={styles.changesTitle}>Message sent to the member</h3>
                <p className={local.text}>{openBooking.responseNote}</p>
              </div>
            ) : null}
            {mayUpdate && detailStep?.blockedReason ? (
              <p className={local.reason}>{detailStep.blockedReason}</p>
            ) : null}
            {mayUpdate && openBooking.status === 'confirmed' && !detailStep ? (
              <p className={local.reason}>
                This booking can be marked completed once its start date has arrived.
              </p>
            ) : null}
            {mayUpdate &&
            (canTransitionBooking(openBooking.status, 'confirmed') ||
              canTransitionBooking(openBooking.status, 'completed')) ? (
              <TextAreaField
                id="booking-note"
                name="note"
                label="Message to member"
                optional
                hint="Shown to the member in their portal and emailed with your decision."
                rows={3}
                maxLength={1000}
                value={note}
                onChange={setNote}
              />
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
