import type { ReactNode } from 'react';

import styles from './AuthLayout.module.css';

export interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  lead?: string;
  brandTitle: string;
  brandLead?: string;
  /** Form panel content (the form or a result/preview panel). */
  children: ReactNode;
  /** Wide (680px) form panel for complex multi-field forms; default is 440px. */
  wide?: boolean;
}

/**
 * Editorial split shell for the AF Homes auth screens.
 *
 * JAD parity structure (AuthLayout): mobile masthead + desktop two-column
 * split with a sticky full-height brand panel beside the form column.
 * AF Homes brand mapping: deep forest-green panel with a harvest-gold rule
 * and the AF Homes Ecofarm wordmark (text, never the JAD logo or realty
 * imagery). Business logic lives in the consuming pages; this is
 * presentation only.
 */
export function AuthLayout({
  eyebrow,
  title,
  lead,
  brandTitle,
  brandLead,
  children,
  wide = false,
}: AuthLayoutProps) {
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
