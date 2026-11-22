import { useMemo, useState, type FormEvent } from 'react';
import { Button, ErrorState } from '@afhomes/ui';
import { BOOKING_STATUS_LABELS, type Booking } from '@afhomes/contracts';
import { formatMoney } from '@afhomes/shared';

import { useBookingsQuery, useCancelBooking, useCreateBooking, useServicesQuery } from './engagement';
import { Card, formatDate } from './portal-ui';
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

export function CustomerBookingsPage() {
  const today = todayLocal();
  const services = useServicesQuery();
  const bookings = useBookingsQuery();
  const create = useCreateBooking();
  const cancel = useCancelBooking();

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

  return (
    <>
      <Card title="Book a service">
        {services.isLoading ? (
          <p role="status">Loading services…</p>
        ) : services.isError ? (
          <p className={styles.error}>We could not load the services. Please try again.</p>
        ) : serviceList.length === 0 ? (
          <p className={styles.hint}>No services are open for booking right now.</p>
        ) : (
          <form className={styles.form} onSubmit={submit} noValidate>
            <p className={styles.hint}>
              AF Homes will confirm your request. It is not booked until you hear back. Payment and
              points are handled separately at the venue.
            </p>
            <label className={styles.label}>
              Service
              <select
                className={styles.control}
                value={serviceId}
                onChange={(e) => setServiceChoice(e.target.value)}
                disabled={serviceList.length === 1}
              >
                {serviceList.length > 1 && <option value="">Select a service</option>}
                {serviceList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {selected && (
                <span className={styles.hint}>
                  {formatMoney(selected.basePrice)} per {selected.pricingUnit}
                  {selected.description ? ` · ${selected.description}` : ''}
                </span>
              )}
            </label>
            <label className={styles.label}>
              Start date
              <input
                className={styles.control}
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              End date (optional)
              <input
                className={styles.control}
                type="date"
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              Guests
              <input
                className={styles.control}
                type="number"
                min={1}
                max={100}
                value={guests}
                onChange={(e) => setGuests(e.target.value)}
              />
            </label>
            <label className={styles.label}>
              Notes (optional)
              <textarea
                className={styles.control}
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {create.isError && (
              <p className={styles.error} role="alert">
                {errorText(create.error)}
              </p>
            )}
            {sent && (
              <p className={styles.hint} role="status">
                Request sent. AF Homes will confirm your request.
              </p>
            )}
            <div>
              <Button type="submit" disabled={Boolean(missing) || create.isPending}>
                Request booking
              </Button>
              {missing && <p className={styles.hint}>{missing}</p>}
            </div>
          </form>
        )}
      </Card>

      <Card title="My bookings">
        {bookings.isLoading ? (
          <p role="status">Loading your bookings…</p>
        ) : bookings.isError ? (
          <ErrorState
            title="Bookings unavailable"
            message="We could not load your bookings. Please try again in a moment."
          />
        ) : (bookings.data ?? []).length === 0 ? (
          <p className={styles.hint}>You have no bookings yet.</p>
        ) : (
          <ul className={styles.list}>
            {(bookings.data ?? []).map((booking) => (
              <li key={booking.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <p className={styles.itemTitle}>{booking.serviceName}</p>
                  <strong>{BOOKING_STATUS_LABELS[booking.status]}</strong>
                </div>
                <p className={styles.meta}>
                  {booking.reference} · {formatDate(booking.startDate)}
                  {booking.endDate ? ` to ${formatDate(booking.endDate)}` : ''} · {booking.guests}{' '}
                  {booking.guests === 1 ? 'guest' : 'guests'}
                </p>
                {booking.responseNote && (
                  <p className={styles.body}>AF Homes: {booking.responseNote}</p>
                )}
                {canCancel(booking, today) && (
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(booking.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {cancel.isError && (
          <p className={styles.error} role="alert">
            {errorText(cancel.error)}
          </p>
        )}
      </Card>
    </>
  );
}
