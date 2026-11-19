import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

/**
 * Success/error notifications (SweetAlert2 modals).
 *
 * Single source for action feedback in the admin and member apps: CRUD
 * saves, approvals, copies, password changes - every notification renders as
 * a proper centered modal with a visible backdrop that blocks the page until
 * it is dismissed (or auto-dismissed for success). Keep these wrappers (not
 * raw `Swal.fire`) so tests can assert on them and the visual contract stays
 * in one place.
 */

export interface NotifyInput {
  title: string;
  message?: string;
  /** Optional second line, rendered under the message. Used for key/value detail. */
  detail?: string;
}

const baseClasses = {
  container: 'afhomes-swal-container',
  popup: 'afhomes-swal-popup',
  title: 'afhomes-swal-title',
  htmlContainer: 'afhomes-swal-text',
  confirmButton: 'afhomes-swal-confirm',
  timerProgressBar: 'afhomes-swal-timer',
} as const;

/**
 * Modal behavior shared by every notification: a visible overlay and no
 * interaction with the page behind the dialog. Applied centrally so future
 * `notify*` callers inherit it automatically.
 */
const modalBehavior = {
  backdrop: true,
  allowOutsideClick: false,
} as const;

/**
 * SweetAlert's `html` is raw markup, so anything interpolated into it must be
 * escaped. Detail lines carry server-returned values (a customer name, a payment
 * reference), so they are never trusted as markup.
 */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}

/**
 * Confirmation before an irreversible or money-moving action.
 *
 * Resolves `true` only when the operator explicitly confirms. Cancellation,
 * the close button and the backdrop all resolve `false`, so a caller cannot
 * treat "the modal went away" as consent.
 */
export function notifyConfirm(input: NotifyInput & { confirmButtonText: string }): Promise<boolean> {
  return Swal.fire({
    icon: 'question',
    title: input.title,
    text: input.message,
    confirmButtonText: input.confirmButtonText,
    cancelButtonText: 'Cancel',
    showCancelButton: true,
    ...modalBehavior,
    customClass: { ...baseClasses },
  }).then((result) => result.isConfirmed === true);
}

/** Successful action - centered modal, auto-dismissing. */
export function notifySuccess(input: NotifyInput): void {
  void Swal.fire({
    icon: 'success',
    title: input.title,
    // SweetAlert renders `html` in preference to `text`, so the two are mutually
    // exclusive: with a detail block the message becomes the first line of it.
    ...(input.detail
      ? {
          html: `${escapeHtml(input.message ?? '')}<br>${escapeHtml(input.detail)
            .split('\n')
            .join('<br>')}`,
        }
      : { text: input.message }),
    timer: 2400,
    timerProgressBar: true,
    showConfirmButton: false,
    ...modalBehavior,
    customClass: { ...baseClasses },
  });
}

/** Failed action - stays open until dismissed. */
export function notifyError(input: NotifyInput): void {
  void Swal.fire({
    icon: 'error',
    title: input.title,
    ...(input.detail
      ? {
          html: `${escapeHtml(input.message ?? '')}<br>${escapeHtml(input.detail)
            .split('\n')
            .join('<br>')}`,
        }
      : { text: input.message }),
    confirmButtonText: 'OK',
    ...modalBehavior,
    customClass: { ...baseClasses },
  });
}

/** Non-blocking warning (e.g. a side effect that needs attention). */
export function notifyWarning(input: NotifyInput): void {
  void Swal.fire({
    icon: 'warning',
    title: input.title,
    text: input.message,
    confirmButtonText: 'OK',
    ...modalBehavior,
    customClass: { ...baseClasses },
  });
}
