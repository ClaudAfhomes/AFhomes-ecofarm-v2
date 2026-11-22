import { Link } from 'react-router';
import { StatusChip, buttonClassName, tierArtwork, tierLabel } from '@afhomes/ui';

import { formatDate, statusTone, ui } from './portal-ui';
import { vipTier } from './vip-tier';
import styles from './dashboard.module.css';

export interface VipCardPreviewProps {
  productCode: string | null;
  productName: string | null;
  status: string;
  memberName?: string;
  membershipNumber: string;
  validUntil: string | null;
  /** Link target for the primary action. */
  href: string;
}

/**
 * Dashboard card: the official tier artwork plus the essentials. It deliberately
 * renders no QR payload, token or secret - the scannable card lives on the
 * membership screen only.
 */
export function VipCardPreview({
  productCode,
  productName,
  status,
  memberName,
  membershipNumber,
  validUntil,
  href,
}: VipCardPreviewProps) {
  const artwork = tierArtwork(productCode);
  return (
    <article className={`${ui.surface} ${styles.card}`} aria-label="Your VIP card">
      <div className={`${styles.stage} ${styles[`tier_${vipTier(productCode)}`] ?? ''}`}>
        <img
          className={styles.art}
          src={artwork.src}
          alt={artwork.alt}
          width={2560}
          height={1597}
          decoding="async"
        />
      </div>
      <div className={styles.cardMeta}>
        <div className={styles.cardHead}>
          <div className={styles.cardTitle}>
            <p className={ui.sectionLabel}>{tierLabel(productName, productCode)}</p>
            {memberName ? <p className={styles.cardName}>{memberName}</p> : null}
          </div>
          <StatusChip label={status} tone={statusTone(status)} />
        </div>
        <p className={styles.cardFacts}>
          <span className={styles.mono}>{membershipNumber}</span>
          <span>Valid until {formatDate(validUntil)}</span>
        </p>
        <div className={styles.cardAction}>
          <Link className={buttonClassName('primary', 'lg')} to={href}>
            View My Card
          </Link>
        </div>
      </div>
    </article>
  );
}
