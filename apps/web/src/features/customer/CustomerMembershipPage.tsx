import { useState } from 'react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Icon,
  QrCode,
  StatusChip,
  tierArtwork,
  tierLabel,
} from '@afhomes/ui';
import { paymentSchemeLabel } from '@afhomes/contracts';

import {
  useCustomerMembershipQuery,
  useCustomerProfileQuery,
  useReissueCredentials,
} from './queries';
import { isForbidden, isNotFound } from './http';
import { PortalSection, formatDate, isNoCard, statusTone, styles, ui } from './portal-ui';
import { vipTier } from './vip-tier';
import type { CustomerCredentials } from './services';
import m from './membership.module.css';

/**
 * Digital VIP card screen.
 *
 * Every active membership carries a persistent, re-displayable card:
 *
 * - the membership number IS the member code (stable, typable at any desk);
 * - the QR renders the one-time `qrToken` - an opaque, rotated secret whose
 *   SHA-256 hash is what the backend matches. It is deliberately NOT the visible
 *   Membership Code: embedding a displayable code in a scannable surface would
 *   leak it to every photograph of the card. (An earlier version of this comment
 *   claimed the QR encoded `AFHOMES:<member code>`; that described the legacy
 *   card envelope the backend still ACCEPTS as compatible lookup input, not what
 *   this portal renders.)
 * - no name, no customer number, no government ID and no NFC involvement of any
 *   kind is encoded in the QR;
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
 * previous pair immediately. Rotation is behind a confirmation so one stray
 * tap can never replace the secret.
 */
export function CustomerMembershipPage() {
  const membership = useCustomerMembershipQuery();
  const profile = useCustomerProfileQuery();
  const reissue = useReissueCredentials();
  const [issued, setIssued] = useState<CustomerCredentials | null>(null);
  const [showQr, setShowQr] = useState(true);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A 404 means "no active membership": show that at once rather than a spinner for
  // as long as the client keeps retrying a read whose answer will not change.
  if (membership.isLoading && !isNoCard(membership)) {
    return <p role="status">Loading your card…</p>;
  }
  if (membership.isError || isNoCard(membership)) {
    return (
      <ErrorState
        title="Card unavailable"
        message={
          isForbidden(membership.error)
            ? 'Your account is not active, so your card is not available. Contact AFhomes Ecofarm to restore access.'
            : isNotFound(membership.failureReason)
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
    <div className={m.stack}>
      <PortalSection title="My Digital VIP Card">
        <div className={`${ui.surface} ${m.hero}`}>
          <div className={`${m.stage} ${m[`tier_${vipTier(card.productCode)}`] ?? ''}`}>
            <img
              className={m.art}
              src={artwork.src}
              alt={artwork.alt}
              width={2560}
              height={1597}
              decoding="async"
            />
          </div>
          <dl className={m.facts}>
            <div className={m.fact}>
              <dt className={ui.sectionLabel}>Member</dt>
              <dd className={m.factValue}>{profile.data?.fullName ?? '—'}</dd>
            </div>
            <div className={m.fact}>
              <dt className={ui.sectionLabel}>Membership Code</dt>
              <dd className={`${m.factValue} ${m.mono}`}>{card.membershipNumber}</dd>
            </div>
            <div className={m.fact}>
              <dt className={ui.sectionLabel}>Tier</dt>
              <dd className={m.factValue}>{tierLabel(card.productName, card.productCode)}</dd>
            </div>
            <div className={m.fact}>
              <dt className={ui.sectionLabel}>Status</dt>
              <dd className={m.factValue}>
                <StatusChip label={card.status} tone={statusTone(card.status)} />
              </dd>
            </div>
            <div className={m.fact}>
              <dt className={ui.sectionLabel}>Valid until</dt>
              <dd className={m.factValue}>{formatDate(card.renewalDueAt)}</dd>
            </div>
          </dl>
        </div>
      </PortalSection>

      <div className={m.pair}>
        <PortalSection title="Scan at the desk">
          <div className={`${ui.surface} ${m.panel}`}>
            {showQr ? (
              <div className={m.qrTile}>
                <QrCode
                  value={card.qrPayload}
                  alt="Your AFhomes Ecofarm member QR code"
                  size={160}
                />
              </div>
            ) : (
              <p className={m.qrHidden} role="status">
                QR hidden. Show it when a desk is ready to scan.
              </p>
            )}
            {/* The Membership Code is shown ONCE, in the summary above as
                "Membership Code". It used to be repeated here as "Member Code"
                with the same value, which read as two different credentials. */}
            <p className={ui.muted}>
              Show this QR or code at any AFhomes Ecofarm desk. It never changes, and viewing it
              never invalidates anything.
            </p>
            <div className={m.actions}>
              <Button variant="secondary" onClick={() => setShowQr((visible) => !visible)}>
                {showQr ? 'Hide QR' : 'Show QR'}
              </Button>
              <Button variant="secondary" onClick={() => void copyMemberCode()}>
                {copied ? 'Copied' : 'Copy Membership Code'}
              </Button>
            </div>
          </div>
        </PortalSection>

        <PortalSection title="Membership details">
          <div className={`${ui.surface} ${m.panel}`}>
            <dl className={m.defs}>
              <DefRow term="Product" value={card.productName ?? 'AFhomes VIP Privilege Card'} />
              {/* The member's OWN agreed scheme - never the internal move playbook. */}
              <DefRow term="Payment scheme" value={paymentSchemeLabel(card.paymentScheme)} />
              <DefRow term="Activated" value={formatDate(card.activatedAt)} />
              {card.validityYears ? (
                <DefRow
                  term="Validity"
                  value={`Valid for ${card.validityYears} year${card.validityYears === 1 ? '' : 's'}`}
                />
              ) : null}
              <DefRow term="VIP Card ID" value={card.vipCardNumber ?? 'Not issued'} />
              <DefRow
                term="Annual points"
                value={card.yearlyPointsAllocated.toLocaleString('en-PH')}
              />
              <DefRow
                term="Points on your card"
                value={card.pointsBalance.toLocaleString('en-PH')}
                hint="Ledger balance on the card, not your available (spendable) points."
              />
            </dl>
          </div>
        </PortalSection>
      </div>

      <section className={m.security} aria-labelledby="card-security-title">
        <div className={m.securityHead}>
          <Icon name="shield-check" size={18} />
          <h2 id="card-security-title" className={m.securityTitle}>
            Card security
          </h2>
        </div>
        <div className={m.securityBody}>
          <p className={ui.muted}>{card.credentialsNote}</p>
          <p className={ui.muted}>
            Lost your printed secret? Requesting a new secret is free and replaces the previous
            secret immediately, so do this only if the old printed secret is genuinely lost. Your
            member code and QR above are unaffected.
          </p>
        </div>
        <div className={m.securityAction}>
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={reissue.isPending}
          >
            {reissue.isPending ? 'Issuing a new secret…' : 'Request a new card secret'}
          </Button>
        </div>
        {reissue.isError && (
          <p className={m.warning} role="alert">
            We could not issue a new secret. Your existing codes are unchanged. Please try again.
          </p>
        )}
      </section>

      {/* A single stray tap must never rotate the secret: confirm first. Cancel
          closes without calling the mutation. */}
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          reissue.mutate(undefined, {
            onSuccess: (next) => setIssued(next),
          });
        }}
        title="Replace your card secret?"
        message="This replaces the previous secret immediately. The old printed secret and fallback code will stop working. Your member code and card QR are unaffected."
        confirmLabel="Replace secret"
        cancelLabel="Cancel"
        danger
      />

      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Your new card secret"
        footer={<Button onClick={() => setIssued(null)}>I have saved my secret</Button>}
      >
        {issued && <IssuedCredentials credentials={issued} />}
      </Dialog>
    </div>
  );
}

function DefRow({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div className={m.defRow}>
      <dt className={m.defTerm}>{term}</dt>
      <dd className={m.defValue}>
        {value}
        {hint ? <span className={m.defHint}>{hint}</span> : null}
      </dd>
    </div>
  );
}

function IssuedCredentials({ credentials }: { credentials: CustomerCredentials }) {
  return (
    <div className={styles.credentialBox}>
      {/* The payload is the opaque token alone - no PII is encoded. */}
      <QrCode value={credentials.qrToken} alt="Your AFhomes Ecofarm member QR code" size={160} />
      <div className={styles.credentialText}>
        <p className={`${styles.notice} ${styles.noticeWarning}`} role="alert">
          Shown once. Close this and the secret cannot be displayed again — request a new pair if
          you lose it. Your member code and card QR are unaffected.
        </p>
        <p className={styles.fieldLabel}>Fallback member code</p>
        <p className={styles.credentialCode}>{credentials.fallbackCode}</p>
        <p className={styles.notice}>
          Show this at any AFhomes Ecofarm desk, in case the QR code cannot be scanned. Staff enter
          it by hand.
        </p>
        <p className={styles.notice}>
          Membership {credentials.membershipNumber}. Issued {formatDate(credentials.issuedAt)}.
        </p>
      </div>
    </div>
  );
}
