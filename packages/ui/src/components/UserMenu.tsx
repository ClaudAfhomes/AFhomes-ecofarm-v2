import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Icon, type IconName } from './Icon.js';
import { useDialogShell } from '../hooks/useDialogShell.js';
import { useDisclosure } from '../hooks/useDisclosure.js';
import styles from './UserMenu.module.css';

export function getInitials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export interface UserMenuItem {
  label: string;
  icon?: string;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
}

export interface UserMenuProps {
  photoUrl?: string | null;
  name?: string;
  role?: string;
  items: UserMenuItem[];
}

export function UserMenu({ name, role, items, photoUrl }: UserMenuProps) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const { isOpen, close, toggle } = useDisclosure();
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useDialogShell({ open: isOpen, onClose: close, panelRef, lockScroll: false });

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Account menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <span
          className={`${styles.avatar} ${photoUrl && photoUrl !== failedPhoto ? styles.hasPhoto : ''}`}
          aria-hidden="true"
        >
          {photoUrl && photoUrl !== failedPhoto ? (
            <img
              className={styles.photo}
              src={photoUrl}
              alt=""
              onError={() => setFailedPhoto(photoUrl)}
            />
          ) : (
            getInitials(name)
          )}
        </span>
        <span className={styles.userInfo}>
          <span className={styles.name}>{name}</span>
          {role ? <span className={styles.role}>{role}</span> : null}
        </span>
        <Icon name="chevron-down" size={16} className={styles.chevron} />
      </button>
      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={close} aria-hidden="true" />
          <div
            ref={panelRef}
            className={styles.panel}
            role="menu"
            aria-label="Account menu"
            tabIndex={-1}
          >
            {items.map((item, i) => {
              const isDivider = item.label === '-';
              if (isDivider) return <div key={`div-${i}`} className={styles.divider} />;
              const icon = (item.icon ?? (item.danger ? 'logout' : 'user')) as IconName;
              const className = item.danger ? styles.itemDanger : styles.item;
              if (item.to) {
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className={className}
                    role="menuitem"
                    onClick={close}
                  >
                    <Icon name={icon} size={16} className={styles.itemIcon} />
                    {item.label}
                  </Link>
                );
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  className={className}
                  role="menuitem"
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                >
                  <Icon name={icon} size={16} className={styles.itemIcon} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
