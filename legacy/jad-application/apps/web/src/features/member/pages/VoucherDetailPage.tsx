import { useState } from 'react';
import { useParams } from 'react-router';

import { formatMoney, isExpired } from '@jad/shared';
import {
  Dialog,
  ErrorState,
  NotFound,
  PageHeader,
  QrCode,
  Skeleton,
  StatusChip,
  downloadQrImage,
} from '@jad/ui';
import type { VoucherStatus } from '@jad/contracts';

import { ButtonLink } from '@/components/ButtonLink';
import { useVoucher } from '../hooks/useMember';
import { formatDate, VOUCHER_STATUS_TONE, voucherStatusLabel } from '../lib/presentation';
import styles from './VoucherDetailPage.module.css';

/**
 * Voucher detail (SCR-MEM-021, FR-VCH-001..003). Shows the voucher and its
 * remaining value (Original − Redeemed = Remaining, BR-VCH-002) plus its
 * human code (JAD-VCH-…) and QR code. Ownership is server-authoritative - an
 * unknown or non-owned id renders a not-found state. Production copy, no dev
 * preview.
 */
export function VoucherDetailPage() {
  const { voucherId = '' } = useParams();
  const voucherQuery = useVoucher(voucherId);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  if (voucherQuery.isError && !voucherQuery.data) {
    return (
      <section>
        <PageHeader title="Voucher not found" />

        <NotFound
          title="Voucher not found"
          action={
            <ButtonLink to="/member/vouchers" variant="secondary">
              All vouchers
            </ButtonLink>
          }
        />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title={voucherQuery.data?.title ?? 'Voucher'}
        description="Voucher details, code, QR code, and remaining value."
        actions={
          <ButtonLink to="/member/vouchers" variant="ghost">
            All vouchers
          </ButtonLink>
        }
      />

      {voucherQuery.isLoading || !voucherQuery.data ? (
        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : voucherQuery.isError ? (
        <ErrorState
          error={voucherQuery.error}
          title="Could not load this voucher"
          onRetry={() => void voucherQuery.refetch()}
        />
      ) : (
        <>
          <div className={styles.qrCard}>
            <button
              type="button"
              className={styles.qrButton}
              onClick={() => setQrOpen(true)}
              aria-label={`View QR code for ${voucherQuery.data.code} enlarged`}
            >
              <QrCode
                value={voucherQuery.data.code}
                size={240}
                alt={`QR code for ${voucherQuery.data.code}`}
                className={styles.qrImage}
              />
            </button>
            <div className={styles.qrMeta}>
              <span className={styles.code}>{voucherQuery.data.code}</span>
              <div className={styles.qrActions}>
                <button
                  type="button"
                  className={styles.copyButton}
                  aria-live="polite"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(voucherQuery.data.code);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1600);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy code'}
                </button>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() =>
                    downloadQrImage(voucherQuery.data.code, `${voucherQuery.data.code}.png`)
                  }
                >
                  Download QR
                </button>
              </div>
            </div>
          </div>

          <dl className={styles.details}>
            <div className={styles.detailItem}>
              <dt>Code</dt>
              <dd className={styles.code}>{voucherQuery.data.code}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Status</dt>
              <dd style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <StatusChip
                  label={voucherStatusLabel(voucherQuery.data.status)}
                  tone={VOUCHER_STATUS_TONE[voucherQuery.data.status as VoucherStatus]}
                />
                {voucherQuery.data.status === 'ACTIVE' && isExpired(voucherQuery.data.expiresAt) ? (
                  <StatusChip label="Expired" tone="warning" />
                ) : null}
              </dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Original value</dt>
              <dd>{formatMoney(voucherQuery.data.originalValue)}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Remaining value</dt>
              <dd className={styles.remainingValue}>
                {formatMoney(voucherQuery.data.remainingValue)}
              </dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Issued</dt>
              <dd>{formatDate(voucherQuery.data.createdAt)}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>Expires</dt>
              <dd>
                {voucherQuery.data.expiresAt
                  ? formatDate(voucherQuery.data.expiresAt)
                  : 'No expiry'}
              </dd>
            </div>
            {voucherQuery.data.redeemedAt ? (
              <div className={styles.detailItem}>
                <dt>Redeemed</dt>
                <dd>{formatDate(voucherQuery.data.redeemedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </>
      )}

      <p className={styles.note}>
        Vouchers are for your use only. Remaining value is server-computed.
      </p>

      <Dialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`QR code - ${voucherQuery.data?.code ?? 'Voucher'}`}
        footer={
          voucherQuery.data ? (
            <button
              type="button"
              className={styles.copyButton}
              onClick={() =>
                downloadQrImage(voucherQuery.data.code, `${voucherQuery.data.code}.png`)
              }
            >
              Download QR
            </button>
          ) : undefined
        }
      >
        {voucherQuery.data ? (
          <div className={styles.qrDialogBody}>
            <QrCode
              value={voucherQuery.data.code}
              size={360}
              alt={`QR code for ${voucherQuery.data.code} large`}
              className={styles.qrLarge}
            />
            <p className={styles.code}>{voucherQuery.data.code}</p>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
