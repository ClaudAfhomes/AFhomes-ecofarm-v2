import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { Link, useLocation, useParams } from 'react-router';
import { Alert, Button, ErrorState, PageHeader, QrCode, Skeleton, StatusChip } from '@afhomes/ui';

import { ApiError, ApiNetworkError, ApiParseError } from '../../lib/api/errors';
import { formatDateTime } from '../../lib/format';
import { humanizeCode } from '../business/format';
import { membershipKeys } from '../business/queryKeys';
import { getMembershipCard, markMembershipPrinted } from './services';
import styles from './MembershipCardPrint.module.css';

type PrintCodes = { fallbackCode?: string; qrToken?: string };

/**
 * Printable membership card (CR80 proportions, print-safe).
 *
 * The QR and fallback code render ONLY when fresh plaintext arrives in-memory
 * from the reissue dialog (location state). Hash-only storage means printed
 * codes cannot be recovered later, so a code-less card prints member, tier,
 * number and status, with guidance to rotate for a coded print. Marking the
 * print records history; it never rotates anything.
 */
export function MembershipCardPrintPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const client = useQueryClient();
  const codes = (location.state ?? null) as PrintCodes | null;
  const card = useQuery({
    queryKey: membershipKeys.card(id),
    queryFn: () => getMembershipCard(id),
    // A print recorded here updates the counts without blanking the card.
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    document.body.classList.add('afh-print-card');
    return () => {
      document.body.classList.remove('afh-print-card');
    };
  }, []);

  const markPrinted = useBusinessMutation({
    mutationFn: () => markMembershipPrinted(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: membershipKeys.card(id) });
      void client.invalidateQueries({ queryKey: membershipKeys.scope });
    },
  });

  // First load skeletonizes the management chrome; the printable card itself
  // renders only from loaded data. The sr-only line keeps the pending copy.
  if (card.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading card"
        >
          <span className="sr-only">Loading card…</span>
          <Skeleton style={{ height: 32, maxWidth: 280 }} />
          <Skeleton style={{ height: 96, maxWidth: 420 }} />
        </div>
      </section>
    );
  if (card.isError)
    return (
      <section>
        <p className={styles.backRow}>
          <Link to={`/admin/memberships/${id}`}>← Back to card management</Link>
        </p>
        <ErrorState
          error={card.error}
          title="Card could not be loaded"
          message={describePrintLoadError(card.error)}
          onRetry={() => void card.refetch()}
        />
      </section>
    );
  const data = card.data;
  const hasCodes = Boolean(codes?.qrToken && codes?.fallbackCode);

  return (
    <section className={styles.printRoot}>
      <div className={styles.screenOnly}>
        <PageHeader
          title="Membership Card Print"
          description={`Card ${data.membershipNumber} · ${data.memberName}`}
        />
        <p className={styles.backRow}>
          <Link to={`/admin/memberships/${id}`}>← Back to card management</Link>
        </p>
        {!hasCodes ? (
          <Alert variant="info" title="No codes on this print">
            <p role="note">
              No codes on this print: stored credentials cannot be recovered, only rotated. To print
              a card WITH codes, rotate them on the management screen and choose “Print with new
              codes”.
            </p>
          </Alert>
        ) : null}
        <div className={styles.screenActions}>
          <Button onClick={() => window.print()}>Print</Button>
          <Button
            variant="secondary"
            onClick={() => markPrinted.mutate()}
            disabled={markPrinted.isPending}
          >
            {markPrinted.isPending ? 'Recording…' : 'Record this print (no code change)'}
          </Button>
        </div>
        {markPrinted.isSuccess ? (
          <p role="status">
            Print #{markPrinted.data.printCount} recorded
            {markPrinted.data.reprint ? ' (reprint)' : ''}.
          </p>
        ) : null}
        {markPrinted.isError ? (
          <p role="alert">
            {markPrinted.error instanceof Error
              ? markPrinted.error.message
              : 'Print was not recorded.'}
          </p>
        ) : null}
      </div>

      <div
        className={styles.card}
        role="img"
        aria-label={`AFHomes membership card for ${data.memberName}`}
      >
        <div className={styles.cardHead}>
          <div>
            <p className={styles.brand}>AFHomes Ecofarm</p>
            <p className={styles.tier}>
              {data.tierName}
              {data.categoryName ? ` · ${data.categoryName}` : ''}
            </p>
          </div>
          <StatusChip label={humanizeCode(data.status)} />
        </div>
        <p className={styles.memberName}>{data.memberName}</p>
        <p className={styles.membershipNumber}>{data.membershipNumber}</p>
        <div className={styles.cardBody}>
          {hasCodes ? (
            <>
              <QrCode
                value={codes!.qrToken!}
                alt={`Member QR for ${data.membershipNumber}`}
                size={120}
              />
              <div>
                <p className={styles.codeLabel}>Fallback member code</p>
                <p className={styles.code}>{codes!.fallbackCode}</p>
              </div>
            </>
          ) : (
            <p className={styles.noCodes}>
              Present this card with a valid ID at any AFHomes Ecofarm desk.
            </p>
          )}
        </div>
        <p className={styles.cardFoot}>
          Activated {data.activatedAt ? formatDateTime(data.activatedAt) : '—'}
          {data.expiresAt ? ` · Valid until ${formatDateTime(data.expiresAt)}` : ''}
          {data.validityYears
            ? ` · Valid for ${data.validityYears} year${data.validityYears === 1 ? '' : 's'}`
            : ''}
        </p>
      </div>
    </section>
  );
}

/**
 * Actionable print-load guidance per failure cause. Raw server internals are
 * never rendered (see `ErrorState`); each branch names the next step instead.
 * Returns `undefined` for unknown errors so the shared generic message applies.
 */
function describePrintLoadError(error: unknown): string | undefined {
  if (error instanceof ApiNetworkError)
    return 'Check your connection and try again. If this continues, contact AFHomes support.';
  if (error instanceof ApiError && error.status === 401)
    return 'Your session has expired. Sign in again, then retry.';
  if (error instanceof ApiError && error.status === 403)
    return 'Your account cannot open this card right now. Contact an administrator.';
  if (error instanceof ApiError && error.status === 404)
    return 'No card exists at this link. Check the address, or open the card from the memberships list.';
  if (error instanceof ApiParseError)
    return 'The saved record contains values this screen cannot display. Note the card number and ask an administrator to review the record.';
  return undefined;
}
