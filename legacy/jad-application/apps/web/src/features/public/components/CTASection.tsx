import type { ReactNode } from 'react';
import type { CmsCtaLink } from '@jad/contracts';

import { ButtonLink } from '../../../components/ButtonLink';
import styles from './CTASection.module.css';

export type CTASectionCta = CmsCtaLink;

export interface CTASectionProps {
  title: string;
  lead?: ReactNode;
  primaryCta: CTASectionCta;
  secondaryCta?: CTASectionCta;
}

/** Full-width brand panel with a headline and up to two actions. */
export function CTASection({ title, lead, primaryCta, secondaryCta }: CTASectionProps) {
  return (
    <section className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <h2 className={styles.title}>{title}</h2>
        {lead ? <p className={`${styles.lead} prose`}>{lead}</p> : null}
        <div className={styles.ctaRow}>
          <CtaLink cta={primaryCta} variant="light" />
          {secondaryCta ? <CtaLink cta={secondaryCta} variant="outlineLight" /> : null}
        </div>
      </div>
    </section>
  );
}

function CtaLink({ cta, variant }: { cta: CTASectionCta; variant: 'light' | 'outlineLight' }) {
  if (typeof cta.href === 'string' && cta.href.length > 0) {
    return (
      <ButtonLink href={cta.href} variant={variant} target="_blank" rel="noopener noreferrer">
        {cta.label}
      </ButtonLink>
    );
  }
  const to = typeof cta.to === 'string' && cta.to.length > 0 ? cta.to : '/';
  return (
    <ButtonLink to={to} variant={variant}>
      {cta.label}
    </ButtonLink>
  );
}
