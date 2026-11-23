import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { useDialogShell } from '../hooks/useDialogShell.js';
import { useDisclosure } from '../hooks/useDisclosure.js';
import { Icon, type IconName } from './Icon.js';
import { IconButton } from './IconButton.js';
import styles from './OverflowMenu.module.css';

export interface OverflowMenuItem {
  /** Visible label. The exact label `'-'` renders a non-interactive separator. */
  label: string;
  icon?: IconName;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface OverflowMenuProps {
  /** Accessible name for the trigger, e.g. "More actions for CUS-000123". */
  label: string;
  items: OverflowMenuItem[];
}

interface PanelPosition {
  top: number;
  left: number;
}

/**
 * Compact per-row action menu: one 40px trigger plus a floating panel.
 *
 * The panel uses `position: fixed` measured from the trigger rect so it is
 * never clipped by scrollable table regions. It flips above the trigger when
 * there is no room below, closes on Escape (via `useDialogShell`), outside
 * pointer-down, scroll and resize, and moves keyboard focus to its first item
 * on open. Destructive items use the danger treatment and callers separate
 * them with a `'-'` separator - never adjacent to the primary row action.
 */
export function OverflowMenu({ label, items }: OverflowMenuProps) {
  const { isOpen, close, toggle } = useDisclosure();
  const triggerRef: RefObject<HTMLSpanElement | null> = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PanelPosition>({ top: 0, left: 0 });

  useDialogShell({ open: isOpen, onClose: close, panelRef, lockScroll: false });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panel.offsetHeight || 0;
    const panelWidth = panel.offsetWidth || 0;
    const gap = 4;
    const below = rect.bottom + gap;
    const top =
      below + panelHeight > window.innerHeight && rect.top - gap - panelHeight >= 0
        ? rect.top - gap - panelHeight
        : below;
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
    setPosition({ top: Math.max(8, top), left });
  }, [isOpen, items]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerOutside(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        close();
      }
    }
    function handleScrollOrResize() {
      close();
    }
    document.addEventListener('mousedown', handlePointerOutside);
    document.addEventListener('touchstart', handlePointerOutside);
    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside);
      document.removeEventListener('touchstart', handlePointerOutside);
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true });
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, close]);

  return (
    <span className={styles.wrapper}>
      <span ref={triggerRef}>
        <IconButton
          icon="more-vertical"
          label={label}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={toggle}
        />
      </span>
      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={close} aria-hidden="true" />
          <div
            ref={panelRef}
            className={styles.panel}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            style={{ top: position.top, left: position.left }}
          >
            {items.map((item, index) => {
              if (item.label === '-') {
                return (
                  <hr key={`separator-${index}`} className={styles.separator} aria-hidden="true" />
                );
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? styles.itemDanger : styles.item}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  <Icon
                    name={item.icon ?? (item.danger ? 'trash' : 'chevron-right')}
                    size={16}
                    className={styles.itemIcon}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </span>
  );
}
