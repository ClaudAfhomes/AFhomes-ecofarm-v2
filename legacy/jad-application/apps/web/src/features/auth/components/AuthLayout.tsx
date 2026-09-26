import type { ReactNode } from 'react';

import type { CmsPhoto } from '@jad/contracts';

import { AUTH_LOGO, authPhoto } from '../content';
import styles from './AuthLayout.module.css';

export interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  lead?: string;
  brandTitle: string;
  brandLead?: string;
  image: { id: string; alt: string };
  brandMark?: CmsPhoto | null;
  /** Form panel content (the form or a result/preview panel). */
  children: ReactNode;
  /** Wide (680px) form panel for complex multi-field forms; default is 440px. */
  wide?: boolean;
}

/**
 * Editorial split shell for the auth screens (SCR-AUTH-001/002).
 *
 * Desktop (≥1024px): a sticky full-height brand panel - property imagery,
 * navy scrim, JA&D logo, editorial headline - beside the authentication form.
 * Below 1024px the imagery is dropped (mobile prioritizes the form, per the
 * auth UX direction) and a slim deep-navy masthead carries the brand eyebrow.
 * The heading level-1 lives in the form panel; the brand headline is styled
 * text, never a competing h1.
 */
export function AuthLayout({
  eyebrow,
  title,
  lead,
  brandTitle,
  brandLead,
  image,
  brandMark,
  children,
  wide = false,
}: AuthLayoutProps) {
  const effectiveMark = brandMark ?? null;
  const logoSrc = effectiveMark?.id ?? AUTH_LOGO.src;
  const logoAlt = effectiveMark?.alt ?? AUTH_LOGO.alt;
  return (
    <div className={styles.page}>
      <div className={styles.masthead}>
        <p className={styles.mastheadText}>{eyebrow}</p>
      </div>
      <div className={styles.split}>
        <aside className={styles.brandPanel}>
          <img
            className={styles.brandImage}
            src={authPhoto(image)}
            alt={image.alt}
            loading="eager"
            decoding="async"
          />
          <div className={styles.scrim} aria-hidden="true" />
          <div className={styles.brandContent}>
            <img
              className={styles.brandLogo}
              src={logoSrc}
              alt={logoAlt}
              width={AUTH_LOGO.width}
              height={AUTH_LOGO.height}
            />
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
