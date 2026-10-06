import type { ReactNode } from 'react';
import { useEffect } from 'react';

import styles from './AuthLayout.module.css';

export interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  lead?: string;
  brandTitle: string;
  brandLead?: string;
  /** Optional breadcrumb rendered at the very top of the form card, above the heading. */
  breadcrumb?: ReactNode;
  /** Form panel content (the form or a result/preview panel). */
  children: ReactNode;
  /** Wide (680px) form panel for complex multi-field forms; default is 440px. */
  wide?: boolean;
}

/**
 * Editorial split shell for the AF Homes auth screens.
 *
 * AF Homes structure (AuthLayout): mobile masthead + desktop two-column
 * split with a sticky full-height brand panel beside the form column.
 * AF Homes brand mapping: deep forest-green panel with a harvest-gold rule
 * and the AF Homes Ecofarm wordmark (text, never a predecessor logo or realty
 * imagery). Business logic lives in the consuming pages; this is
 * presentation only.
 */
export function AuthLayout({
  eyebrow,
  title,
  lead,
  brandTitle,
  brandLead,
  breadcrumb,
  children,
  wide = false,
}: AuthLayoutProps) {
  // Auth screens are never indexable: no login, activation, recovery or
  // registration page should appear in search results.
  useEffect(() => {
    const head = document.head;
    let element = head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !element;
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute('name', 'robots');
      head.appendChild(element);
    }
    const previous = element.getAttribute('content');
    element.setAttribute('content', 'noindex, nofollow');
    return () => {
      if (created) element?.remove();
      else if (previous !== null) element?.setAttribute('content', previous);
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.masthead}>
        <p className={styles.mastheadText}>{eyebrow}</p>
      </div>
      <div className={styles.split}>
        <aside className={styles.brandPanel} aria-hidden="true">
          <div className={styles.scrim} />
          <div className={styles.brandContent}>
            <p className={styles.brandWordmark}>AF Homes Ecofarm</p>
            <p className={styles.brandEyebrow}>{eyebrow}</p>
            <p className={styles.brandTitle}>{brandTitle}</p>
            {brandLead ? <p className={styles.brandLead}>{brandLead}</p> : null}
          </div>
        </aside>
        <div className={styles.formColumn}>
          <div className={`${styles.formPanel} ${wide ? styles.formPanelWide : ''}`}>
            {breadcrumb}
            <div className={styles.heading}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              {lead ? <p className={styles.lead}>{lead}</p> : null}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
