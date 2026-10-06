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

/** Successful action - centered modal, auto-dismissing. */
export function notifySuccess(input: NotifyInput): void {
  void Swal.fire({
    icon: 'success',
    title: input.title,
    text: input.message,
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
    text: input.message,
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
