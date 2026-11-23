import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button, ErrorState, Icon, StatusChip } from '@afhomes/ui';
import { BOOKING_STATUS_LABELS, type Booking } from '@afhomes/contracts';
import { formatMoney } from '@afhomes/shared';

import {
  useBookingsQuery,
  useCancelBooking,
  useCreateBooking,
  useServicesQuery,
} from './engagement';
import { ActivityListSkeleton, PortalSection, formatDate, statusTone, ui } from './portal-ui';
import styles from './engagement.module.css';

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

/** Local calendar date as YYYY-MM-DD (the member's "today"). */
const todayLocal = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Cancel is offered only while a request is live and has not started. The server decides. */
const canCancel = (booking: Booking, today: string): boolean =>
  (booking.status === 'requested' || booking.status === 'confirmed') && booking.startDate >= today;

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className={styles.error}>
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </p>
  );
}

export function CustomerBookingsPage() {
  const today = todayLocal();
  const services = useServicesQuery();
  const bookings = useBookingsQuery();
  const create = useCreateBooking();
  const cancel = useCancelBooking();
  const uid = useId();

  const [serviceChoice, setServiceChoice] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [guests, setGuests] = useState('1');
  const [notes, setNotes] = useState('');
  // One id per submission; reused on retry so the server can de-duplicate.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState(false);

  const serviceList = useMemo(() => services.data ?? [], [services.data]);
  const serviceId = serviceChoice || (serviceList.length === 1 ? serviceList[0]!.id : '');
  const selected = serviceList.find((s) => s.id === serviceId);
  const guestCount = Number(guests);
  const guestsValid = Number.isInteger(guestCount) && guestCount >= 1 && guestCount <= 100;
  const endValid = !endDate || endDate >= startDate;
  const missing = !serviceId
    ? 'Choose a service.'
    : !startDate
      ? 'Choose a start date.'
      : !endValid
        ? 'The end date cannot be before the start date.'
        : !guestsValid
          ? 'Guests must be between 1 and 100.'
          : null;
  // Required prompts show by the submit button; value errors show on their own field.
  const prompt = !serviceId || !startDate ? missing : null;

  const ids = {
    service: `${uid}-service`,
    serviceHint: `${uid}-service-hint`,
    start: `${uid}-start`,
    end: `${uid}-end`,
    endError: `${uid}-end-error`,
    guests: `${uid}-guests`,
    guestsError: `${uid}-guests-error`,
    notes: `${uid}-notes`,
    prompt: `${uid}-prompt`,
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (missing) return;
    setSent(false);
    create.mutate(
      {
        requestId,
        serviceId,
        startDate,
        ...(endDate ? { endDate } : {}),
        guests: guestCount,
        notes: notes.trim(),
      },
      {
        onSuccess: () => {
          setSent(true);
          setStartDate('');
          setEndDate('');
          setGuests('1');
          setNotes('');
          setRequestId(crypto.randomUUID());
        },
      },
    );
  };

  const bookingList = bookings.data ?? [];

  return (
    <div className={styles.page}>
      <PortalSection
        title="Book a service"
        description="Request a service for the dates you choose."
      >
        <div className={`${ui.surface} ${styles.panel}`}>
          {services.isLoading ? (
            <p role="status" className={styles.status}>
              Loading services…
            </p>
          ) : services.isError ? (
            <p className={styles.error} role="alert">
              <Icon name="alert" size={16} />
              <span>We could not load the services. Please try again.</span>
            </p>
          ) : serviceList.length === 0 ? (
            <p className={styles.status}>No services are open for booking right now.</p>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate>
              <p className={styles.notice}>
                <Icon name="info" size={18} />
                <span>
                  AF Homes will confirm your request. It is not booked until you hear back. Payment
                  and points are handled separately at the venue.
                </span>
              </p>

              <div className={styles.group} role="group" aria-labelledby={`${uid}-g-dates`}>
                <p id={`${uid}-g-dates`} className={styles.groupLabel}>
                  Service and dates
                </p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={ids.service}>
                    Service
                  </label>
                  <select
                    id={ids.service}
                    className={styles.control}
                    value={serviceId}
                    onChange={(e) => setServiceChoice(e.target.value)}
                    disabled={serviceList.length === 1}
                    aria-describedby={selected ? ids.serviceHint : undefined}
                  >
                    {serviceList.length > 1 && <option value="">Select a service</option>}
                    {serviceList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {selected && (
                    <span id={ids.serviceHint} className={styles.hint}>
                      {formatMoney(selected.basePrice)} per {selected.pricingUnit}
                      {selected.description ? ` · ${selected.description}` : ''}
                    </span>
                  )}
                </div>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.start}>
                      Start date
                    </label>
                    <input
                      id={ids.start}
                      className={styles.control}
                      type="date"
                      min={today}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={ids.end}>
                      End date <span className={styles.optional}>(optional)</span>
                    </label>
                    <input
                      id={ids.end}
                      className={`${styles.control} ${endValid ? '' : styles.controlInvalid}`}
                      type="date"
                      min={startDate || today}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      aria-invalid={endValid ? undefined : true}
                      aria-describedby={endValid ? undefined : ids.endError}
                    />
                    {!endValid && (
                      <FieldError id={ids.endError}>
                        The end date cannot be before the start date.
                      </FieldError>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.group} role="group" aria-labelledby={`${uid}-g-details`}>
                <p id={`${uid}-g-details`} className={styles.groupLabel}>
                  Details
                </p>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={ids.guests}>
                    Guests
                  </label>
                  <input
                    id={ids.guests}
                    className={`${styles.control} ${guestsValid ? '' : styles.controlInvalid}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={guests}
                    onChange={(e) => setGuests(e.target.value)}
                    aria-invalid={guestsValid ? undefined : true}
                    aria-describedby={guestsValid ? undefined : ids.guestsError}
                  />
                  {!guestsValid && (
                    <FieldError id={ids.guestsError}>Guests must be between 1 and 100.</FieldError>
                  )}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={ids.notes}>
                    Notes <span className={styles.optional}>(optional)</span>
                  </label>
                  <textarea
                    id={ids.notes}
                    className={styles.control}
                    rows={3}
                    maxLength={1000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {create.isError && (
                <p className={styles.error} role="alert">
                  <Icon name="alert" size={16} />
                  <span>{errorText(create.error)}</span>
                </p>
              )}
              {sent && (
                <p className={styles.success} role="status">
                  Request sent. AF Homes will confirm your request.
                </p>
              )}
              <div className={styles.submitRow}>
                <Button
                  type="submit"
                  size="lg"
                  className={styles.fullMobile}
                  disabled={Boolean(missing)}
                  loading={create.isPending}
                  loadingLabel="Sending request…"
                  aria-describedby={prompt ? ids.prompt : undefined}
                >
                  Request booking
                </Button>
                {prompt && (
                  <p id={ids.prompt} className={styles.hint}>
                    {prompt}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>
      </PortalSection>

      <PortalSection title="My bookings" description="Requests you have made and their status.">
        {bookings.isLoading ? (
          <div className={`${ui.surface} ${styles.panel}`}>
            <p role="status" className="sr-only">
              Loading your bookings…
            </p>
            <div aria-hidden="true">
              <ActivityListSkeleton rows={2} />
            </div>
          </div>
        ) : bookings.isError ? (
          <ErrorState
            title="Bookings unavailable"
            message="We could not load your bookings. Please try again in a moment."
          />
        ) : bookingList.length === 0 ? (
          <div className={`${ui.surface} ${styles.panel}`}>
            <p className={styles.status}>You have no bookings yet.</p>
          </div>
        ) : (
          <ul className={styles.records} aria-label="My bookings">
            {bookingList.map((booking) => {
              const titleId = `${uid}-b-${booking.id}`;
              return (
                <li key={booking.id} className={`${ui.surface} ${styles.record}`}>
                  <div className={styles.recordHead}>
                    <div>
                      <p id={titleId} className={styles.recordTitle}>
                        {booking.serviceName}
                      </p>
                      <p className={styles.recordRef}>{booking.reference}</p>
                    </div>
                    <span className={styles.chipSlot}>
                      <StatusChip
                        label={BOOKING_STATUS_LABELS[booking.status]}
                        tone={statusTone(booking.status)}
                      />
                    </span>
                  </div>
                  <ul className={styles.facts}>
                    <li className={styles.fact}>
                      <Icon name="calendar" size={16} />
                      <span>
                        {formatDate(booking.startDate)}
                        {booking.endDate ? ` to ${formatDate(booking.endDate)}` : ''}
                      </span>
                    </li>
                    <li className={styles.fact}>
                      <Icon name="users" size={16} />
                      <span>
                        {booking.guests} {booking.guests === 1 ? 'guest' : 'guests'}
                      </span>
                    </li>
                  </ul>
                  {booking.customerNotes && (
                    <div className={styles.quote}>
                      <p className={styles.quoteLabel}>Your note</p>
                      <p className={styles.body}>{booking.customerNotes}</p>
                    </div>
                  )}
                  {booking.responseNote && (
                    <div className={styles.quote}>
                      <p className={styles.quoteLabel}>AF Homes</p>
                      <p className={styles.body}>{booking.responseNote}</p>
                    </div>
                  )}
                  {canCancel(booking, today) && (
                    <div className={styles.recordFoot}>
                      <Button
                        variant="secondary"
                        className={styles.tap}
                        disabled={cancel.isPending}
                        aria-describedby={titleId}
                        onClick={() => cancel.mutate(booking.id)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {cancel.isError && (
          <p className={styles.error} role="alert">
            <Icon name="alert" size={16} />
            <span>{errorText(cancel.error)}</span>
          </p>
        )}
      </PortalSection>
    </div>
  );
}
