import { useState } from 'react';
import { Button, Dialog, ErrorState, QrCode, StatusChip, type StatusTone } from '@jad/ui';
import { paymentSchemeLabel } from '@jad/contracts';

import {
  useCustomerMembershipQuery,
  useCustomerProfileQuery,
  useReissueCredentials,
} from './queries';
import { isForbidden, isNotFound } from './http';
import { Card, Field, FieldList, formatDate, styles } from './portal-ui';
import { tierArtwork, tierLabel } from './tierArtwork';
import type { CustomerCredentials } from './services';

/**
 * Digital VIP card screen.
 *
 * Every active membership carries a persistent, re-displayable card:
 *
 * - the membership number IS the member code (stable, typable at any desk);
 * - the QR encodes `AFHOMES:<member code>` and nothing else - no name, no
 *   customer number beyond the code itself, no government ID, no token, no
 *   JWT, no NFC involvement of any kind;
 * - viewing the card never rotates anything: the code and the QR are the
 *   same on every visit, and staff resolve them to the same membership.
 *
 * Possession of the code authorizes nothing by itself. The backend still
 * verifies membership status, expiry, the points account, the item and the
 * acting staff member on every redemption.
 *
 * Separate from the card are the ONE-TIME secrets minted at activation (QR
 * token + fallback member code). Only hashes are stored, so those can never
 * be displayed - only rotated via the request below, which invalidates the
 * previous pair immediately.
 */
export function CustomerMembershipPage() {
  const membership = useCustomerMembershipQuery();
  const profile = useCustomerProfileQuery();
  const reissue = useReissueCredentials();
  const [issued, setIssued] = useState<CustomerCredentials | null>(null);
  const [showQr, setShowQr] = useState(true);
  const [copied, setCopied] = useState(false);

  if (membership.isLoading) return <p role="status">Loading your card…</p>;
  if (membership.isError) {
    return (
      <ErrorState
        title="Card unavailable"
        message={
          isForbidden(membership.error)
            ? 'Your account is not active, so your card is not available. Contact AF Homes Ecofarm to restore access.'
            : isNotFound(membership.error)
              ? 'You do not have an active membership yet.'
              : 'We could not load your card. Please try again in a moment.'
        }
      />
    );
  }
  const card = membership.data!;
  const artwork = tierArtwork(card.productCode);

  const copyMemberCode = async () => {
    try {
      await navigator.clipboard.writeText(card.memberCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <Card title="My Digital VIP Card">
        <div className={styles.digitalCard}>
          <img
            className={styles.digitalArt}
            src={artwork.src}
            alt={artwork.alt}
            width={512}
            height={320}
          />
          <dl className={styles.digitalDetails}>
            <div className={styles.digitalRow}>
              <dt className={styles.fieldLabel}>Member</dt>
              <dd className={styles.digitalValue}>
                {profile.data?.fullName ?? '—'}
              </dd>
            </div>
            <div className={styles.digitalRow}>
              <dt className={styles.fieldLabel}>Membership</dt>
              <dd className={`${styles.digitalValue} ${styles.mono}`}>{card.membershipNumber}</dd>
            </div>
            <div className={styles.digitalRow}>
              <dt className={styles.fieldLabel}>Tier</dt>
              <dd className={styles.digitalValue}>
                {tierLabel(card.productName, card.productCode)}
              </dd>
            </div>
            <div className={styles.digitalRow}>
              <dt className={styles.fieldLabel}>Status</dt>
              <dd className={styles.digitalValue}>
                <StatusChip label={card.status} tone={toneFor(card.status)} />
              </dd>
            </div>
            <div className={styles.digitalRow}>
              <dt className={styles.fieldLabel}>Valid until</dt>
              <dd className={styles.digitalValue}>{formatDate(card.renewalDueAt)}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.credentialBox}>
          {showQr ? (
            <QrCode
              value={card.qrPayload}
              alt="Your AF Homes Ecofarm member QR code"
              size={160}
            />
          ) : (
            <p className={styles.notice} role="status">
              QR hidden. Show it when a desk is ready to scan.
            </p>
          )}
          <div className={styles.credentialText}>
            <p className={styles.fieldLabel}>Member Code</p>
            <p className={styles.credentialCode}>{card.memberCode}</p>
            <p className={styles.notice}>
              Show this QR or code at any AF Homes Ecofarm desk. It never changes, and viewing
              it never invalidates anything.
            </p>
            <div className={styles.digitalActions}>
              <Button variant="secondary" onClick={() => setShowQr((visible) => !visible)}>
                {showQr ? 'Hide QR' : 'Show QR'}
              </Button>
              <Button variant="secondary" onClick={() => void copyMemberCode()}>
                {copied ? 'Copied' : 'Copy Member Code'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Membership details">
        <FieldList>
          <Field label="Product" value={card.productName ?? 'AF Homes card'} />
          {/* The member's OWN agreed scheme - never the internal move playbook. */}
          <Field label="Payment scheme" value={paymentSchemeLabel(card.paymentScheme)} />
          <Field label="Activated" value={formatDate(card.activatedAt)} />
          {card.validityYears ? (
            <Field
              label="Validity"
              value={`Valid for ${card.validityYears} year${card.validityYears === 1 ? '' : 's'}`}
            />
          ) : null}
          <Field label="Points balance" value={card.pointsBalance.toLocaleString('en-PH')} />
        </FieldList>
      </Card>

      <Card title="Lost printed secret?">
        <p className={styles.notice}>{card.credentialsNote}</p>
        <p className={styles.notice}>
          Requesting a new secret is free and replaces the previous secret immediately, so do
          this only if the old printed secret is genuinely lost. Your member code and QR above
          are unaffected.
        </p>
        <Button
          onClick={() => {
            reissue.mutate(undefined, {
              onSuccess: (next) => setIssued(next),
            });
          }}
          disabled={reissue.isPending}
        >
          {reissue.isPending ? 'Issuing a new secret…' : 'Request a new card secret'}
        </Button>
        {reissue.isError && (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
            We could not issue a new secret. Your existing codes are unchanged. Please try again.
          </p>
        )}
      </Card>

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Your new card secret"
        footer={<Button onClick={() => setIssued(null)}>I have saved my secret</Button>}
      >
        {issued && <IssuedCredentials credentials={issued} />}
      </Dialog>
    </>
  );
}

function IssuedCredentials({ credentials }: { credentials: CustomerCredentials }) {
  return (
    <div className={styles.credentialBox}>
      {/* The payload is the opaque token alone - no PII is encoded. */}
      <QrCode value={credentials.qrToken} alt="Your AF Homes Ecofarm member QR code" size={160} />
      <div className={styles.credentialText}>
        <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          Shown once. Close this and the secret cannot be displayed again — request a new pair
          if you lose it. Your member code and card QR are unaffected.
        </p>
        <p className={styles.fieldLabel}>Fallback member code</p>
        <p className={styles.credentialCode}>{credentials.fallbackCode}</p>
        <p className={styles.notice}>
          Show this at any AF Homes Ecofarm desk, in case the QR code cannot be scanned. Staff
          enter it by hand.
        </p>
        <p className={styles.notice}>
          Membership {credentials.membershipNumber}. Issued {formatDate(credentials.issuedAt)}.
        </p>
      </div>
    </div>
  );
}

const toneFor = (status: string): StatusTone =>
  status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'neutral';
