import { useState } from 'react';
import { Button, Dialog, ErrorState, QrCode, StatusChip, type StatusTone } from '@jad/ui';

import { useCustomerMembershipQuery, useReissueCredentials } from './queries';
import { isForbidden, isNotFound } from './http';
import { Card, Field, FieldList, formatDate, styles } from './portal-ui';
import type { CustomerCredentials } from './services';

/**
 * Membership / card screen, including the card credential policy.
 *
 * The policy, stated to the member in plain language:
 *
 * Only a SHA-256 hash of the QR token and of the fallback member code is stored,
 * so neither can be shown on demand without weakening at-rest security. Instead
 * the codes are ROTATED: the member asks for a new pair, the previous pair stops
 * working immediately, and the new pair is displayed exactly once.
 *
 * The plaintext therefore lives in React state for exactly as long as the
 * disclosure dialog is open, and is never persisted, never logged and never
 * re-fetched. The re-issue request is a manual, never-retried mutation.
 *
 * The QR payload is the opaque token only - no name, no customer number, no
 * government ID, nothing else. Anyone photographing the QR learns nothing beyond
 * the token itself.
 */
export function CustomerMembershipPage() {
  const membership = useCustomerMembershipQuery();
  const reissue = useReissueCredentials();
  const [issued, setIssued] = useState<CustomerCredentials | null>(null);

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

  return (
    <>
      <Card title="Membership">
        <FieldList>
          <Field label="Membership number" value={card.membershipNumber} />
          <Field label="Product" value={card.productName ?? 'AF Homes card'} />
          <Field
            label="Status"
            value={<StatusChip label={card.status} tone={toneFor(card.status)} />}
          />
          <Field label="Activated" value={formatDate(card.activatedAt)} />
          <Field label="Renews" value={formatDate(card.renewalDueAt)} />
          <Field label="Points balance" value={card.pointsBalance.toLocaleString('en-PH')} />
        </FieldList>
      </Card>

      <Card title="Your card code">
        <p className={`${styles.notice} ${styles.noticeWarning}`}>{card.credentialsNote}</p>
        <p className={styles.notice}>
          Requesting a new code is free and can be done whenever you lose the old one. It replaces
          the previous code immediately, so do this only if the old one is genuinely lost.
        </p>
        <Button
          onClick={() => {
            reissue.mutate(undefined, {
              onSuccess: (next) => setIssued(next),
            });
          }}
          disabled={reissue.isPending}
        >
          {reissue.isPending ? 'Issuing a new code…' : 'Request a new card code'}
        </Button>
        {reissue.isError && (
          <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
            We could not issue a new code. Your existing code is unchanged. Please try again.
          </p>
        )}
      </Card>

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Your new card code"
        footer={<Button onClick={() => setIssued(null)}>I have saved my code</Button>}
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
          Shown once. Close this and the codes cannot be displayed again — request a new pair if
          you lose them.
        </p>
        <p className={styles.fieldLabel}>Fallback member code</p>
        <p className={styles.credentialCode}>{credentials.fallbackCode}</p>
        <p className={styles.notice}>
          Show this at any AF Homes Ecofarm desk, in case the QR code cannot be scanned. Staff
          enter it by hand.
        </p>
        <p className={styles.notice}>
          Membership {credentials.membershipNumber}. Issued{' '}
          {formatDate(credentials.issuedAt)}.
        </p>
      </div>
    </div>
  );
}

const toneFor = (status: string): StatusTone =>
  status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'neutral';
