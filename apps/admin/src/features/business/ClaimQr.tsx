/**
 * A single-use claim QR, rendered for the member to present or for staff to print.
 *
 * The QR encodes a CLAIM URL, not the bare token, so the same code works when the
 * member opens it on their own phone and when a member of staff scans it at the
 * desk. The URL carries only the opaque credential: no customer id, no name, no
 * membership number. The server extracts it and re-verifies ownership anyway, so
 * the token is a single-use secret rather than an authorization.
 *
 * Token hygiene, which is the whole reason this is a separate component:
 *
 *  - The token is rendered ONCE, at issuance, and never cached or persisted by
 *    this component. `issuedClaims` is component state that dies with the dialog.
 *  - The image is generated locally by the `qrcode` package, so no frame, no
 *    token and no URL ever reaches a third-party service.
 *  - Printing is an explicit user action on an already-revealed code, so nothing
 *    is silently written to disk or sent anywhere.
 *  - `downloadQrImage` re-renders the same local data URL; it does not upload.
 */
import { useState } from 'react';
import { Button, QrCode, downloadQrImage } from '@afhomes/ui';

import { webBase } from '../../lib/portal';
import styles from './points.module.css';

/**
 * The canonical claim URL. The `c=` parameter is the credential, which is why it
 * is written into a query string rather than a fragment: the customer claim page
 * reads it on load and immediately scrubs it from the address bar so the token
 * does not linger in history.
 */
export function claimUrl(token: string): string {
  return `${webBase().replace(/\/$/, '')}/customer/points?c=${encodeURIComponent(token)}`;
}

export type IssuedClaim = {
  claimNumber: string;
  qrToken: string;
  fallbackCode: string;
  expiresAt: string;
};

export function ClaimQr({ claim }: { claim: IssuedClaim }) {
  const [copied, setCopied] = useState(false);
  const url = claimUrl(claim.qrToken);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={styles.claimQr}>
      <QrCode value={url} alt={`Claim QR for ${claim.claimNumber}`} size={200} />
      <p className={styles.claimQrHint}>
        The member can scan this with their phone camera, or enter the code below in their own
        customer account. Both use the same claim.
      </p>

      <dl className={styles.claimQrFacts}>
        <dt>Claim</dt>
        <dd className={styles.mono}>{claim.claimNumber}</dd>
        <dt>Typed code</dt>
        <dd className={styles.mono}>{claim.fallbackCode}</dd>
        <dt>Expires</dt>
        <dd>{new Date(claim.expiresAt).toLocaleString('en-PH')}</dd>
      </dl>

      <div className={styles.claimQrActions}>
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? 'Link copied' : 'Copy claim link'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void downloadQrImage(url, `afhomes-claim-${claim.claimNumber}.png`)}
        >
          Download QR
        </Button>
      </div>

      {/* Spoken by a screen reader; the image alone conveys nothing useful. */}
      <p role="status" aria-live="polite">
        {copied ? 'Claim link copied to the clipboard.' : ''}
      </p>
    </div>
  );
}
