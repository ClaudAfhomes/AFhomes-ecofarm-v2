import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Button, ErrorState, QrCode, StatusChip } from '@jad/ui';

import { formatDateTime } from '../../lib/format';
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
    queryKey: ['memberships', id, 'card'],
    queryFn: () => getMembershipCard(id),
  });

  useEffect(() => {
    document.body.classList.add('afh-print-card');
    return () => {
      document.body.classList.remove('afh-print-card');
    };
  }, []);

  const markPrinted = useMutation({
    mutationFn: () => markMembershipPrinted(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['memberships', id] });
    },
  });

  if (card.isPending) return <p role="status">Loading card…</p>;
  if (card.isError) return <ErrorState error={card.error} onRetry={card.refetch} />;
  const data = card.data;
  const hasCodes = Boolean(codes?.qrToken && codes?.fallbackCode);

  return (
    <section className={styles.printRoot}>
      <div className={styles.screenOnly}>
        <p>
          <Link to={`/admin/memberships/${id}`}>← Back to card management</Link>
        </p>
        {!hasCodes ? (
          <p role="note">
            No codes on this print: stored credentials cannot be recovered, only rotated. To print a
            card WITH codes, rotate them on the management screen and choose “Print with new codes”.
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
        aria-label={`AF Homes membership card for ${data.memberName}`}
      >
        <div className={styles.cardHead}>
          <div>
            <p className={styles.brand}>AF Homes Ecofarm</p>
            <p className={styles.tier}>
              {data.tierName}
              {data.categoryName ? ` · ${data.categoryName}` : ''}
            </p>
          </div>
          <StatusChip label={data.status} tone={data.status === 'active' ? 'success' : 'neutral'} />
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
              Present this card with a valid ID at any AF Homes Ecofarm desk.
            </p>
          )}
        </div>
        <p className={styles.cardFoot}>
          Activated {data.activatedAt ? formatDateTime(data.activatedAt) : '—'}
          {data.expiresAt ? ` · Valid until ${formatDateTime(data.expiresAt)}` : ''}
          {data.validityYears ? ` · Valid for ${data.validityYears} year${data.validityYears === 1 ? '' : 's'}` : ''}
        </p>
      </div>
    </section>
  );
}
