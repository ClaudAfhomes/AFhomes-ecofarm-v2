import type { CmsCtaLink } from '@jad/contracts';

import { ButtonLink } from '../../../components/ButtonLink';
import { photoSrcSet, photoUrl } from '../content';
import styles from './Hero.module.css';

export type HeroCta = CmsCtaLink;

export type HeroVariant = 'home' | 'page';

export interface HeroProps {
  /** `home` - tall, dual CTAs. `page` - shorter, single CTA. */
  variant?: HeroVariant;
  eyebrow?: string;
  title: string;
  lead?: string;
  primaryCta?: HeroCta;
  secondaryCta?: HeroCta;
  image: { id: string; alt: string };
}

/**
 * Shared full-bleed hero for every public landing page. One component, two
 * variants (`home` / `page`) that share the same background treatment, dark
 * scrim, typography, spacing, and CTA placement - variation comes from the
 * per-page image and copy, not from divergent markup. The image is the LCP
 * element (eager, high fetch priority); the scrim keeps text AA-readable.
 */
function HeroCtaLink({ cta, variant }: { cta: HeroCta; variant: 'primary' | 'outlineLight' }) {
  if (typeof cta.href === 'string' && cta.href.length > 0) {
    return (
      <ButtonLink href={cta.href} variant={variant} target="_blank" rel="noopener noreferrer">
        {cta.label}
      </ButtonLink>
    );
  }
  // cmsCtaLinkSchema guarantees exactly one of `to`/`href`; fallback to `to` when `href` is absent
  const to = typeof cta.to === 'string' && cta.to.length > 0 ? cta.to : '/';
  return (
    <ButtonLink to={to} variant={variant}>
      {cta.label}
    </ButtonLink>
  );
}

export function Hero({
  variant = 'home',
  eyebrow,
  title,
  lead,
  primaryCta,
  secondaryCta,
  image,
}: HeroProps) {
  const hasCta = Boolean(primaryCta || secondaryCta);

  return (
    <section className={`${styles.hero} ${variant === 'home' ? styles.home : styles.page}`}>
      <div className={styles.media}>
        <img
          className={styles.image}
          src={photoUrl(image.id, 1600)}
          srcSet={photoSrcSet(image.id, [640, 960, 1280, 1600])}
          sizes="100vw"
          alt={image.alt}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <div className={styles.scrim} aria-hidden="true" />
      <div className={`container ${styles.content}`}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
        {hasCta ? (
          <div className={styles.ctaRow}>
            {primaryCta ? <HeroCtaLink cta={primaryCta} variant="primary" /> : null}
            {secondaryCta ? <HeroCtaLink cta={secondaryCta} variant="outlineLight" /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
