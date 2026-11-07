import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

let scrollLocks = 0;
let unlockedOverflow = '';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface DialogShellOptions {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
  lockScroll?: boolean;
}

/**
 * Shared behavior for modal surfaces (Dialog, MobileDrawer, confirm): body
 * scroll lock while open, Escape to close, focus moved into the panel on open
 * (an element with `data-autofocus` wins, else the first focusable element),
 * a Tab focus trap, and focus restored to the trigger on close
 * (DESIGN-SYSTEM §7, UI-UX §12.6).
 */
export function useDialogShell({
  open,
  onClose,
  panelRef,
  restoreFocus = true,
  lockScroll = true,
}: DialogShellOptions): void {
  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const restore = (): void => {
      if (restoreFocus && previouslyFocused) previouslyFocused.focus();
    };

    if (!lockScroll) {
      return restore;
    }

    if (scrollLocks++ === 0) {
      unlockedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = unlockedOverflow;
      restore();
    };
  }, [open, panelRef, restoreFocus, lockScroll]);

  // Mirror the latest onClose so the keydown listener stays fresh without
  // resubscribing (and re-running focus logic) on every parent re-render -
  // consumers pass inline `onClose` closures with unstable identity.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Move initial focus into the panel exactly once per open transition.
  // Previously this lived in the same effect as the keydown listener, so any
  // parent re-render (e.g. typing into a parent-owned input) re-fired
  // `first.focus()` and yanked focus back to the first focusable element.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open || wasOpen) return;

    const panel = panelRef.current;
    if (!panel) return;

    const autofocusTarget = panel.querySelector<HTMLElement>('[data-autofocus]');
    const focusables = getFocusable(panel);
    const first = autofocusTarget ?? focusables[0] ?? panel;
    first.focus();
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = getFocusable(panel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === firstEl || active === panel)) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, panelRef]);
}
