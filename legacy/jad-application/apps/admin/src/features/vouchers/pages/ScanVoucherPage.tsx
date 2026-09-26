import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Button,
  Dialog,
  PageHeader,
  QrCode,
  Spinner,
  StatusChip,
  Tabs,
  getInitials,
  notifyError,
  notifySuccess,
} from '@jad/ui';
import { formatMoney, isExpired } from '@jad/shared';
import type { VoucherAssignment } from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { useScanVoucher } from '../hooks/useScanVoucher';
import { useRedeemVoucher } from '../hooks/useRedeemVoucher';
import { useQrScanner, type ScannerStatus } from '../hooks/useQrScanner';
import { useQrImageUpload } from '../hooks/useQrImageUpload';
import { VOUCHER_STATUS_LABEL, VOUCHER_STATUS_TONE } from '../status';
import styles from './ScanVoucherPage.module.css';

type ScanStage =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; voucher: VoucherAssignment }
  | { kind: 'error'; message: string };

type InputMode = 'camera' | 'manual' | 'upload';

const INPUT_MODE_TABS = [
  { value: 'camera', label: 'Camera' },
  { value: 'manual', label: 'Manual' },
  { value: 'upload', label: 'Upload' },
];

export function ScanVoucherPage() {
  const navigate = useNavigate();
  const scanMutation = useScanVoucher();
  const redeemMutation = useRedeemVoucher();
  const [mode, setMode] = useState<InputMode>('camera');
  const [manualCode, setManualCode] = useState('');
  const [stage, setStage] = useState<ScanStage>({ kind: 'idle' });
  const [redeeming, setRedeeming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Guards the camera path: the first decode starts the lookup and every
  // frame after it is ignored until the operator scans again, so a QR held
  // in the viewfinder can never fire duplicate lookups.
  const busyRef = useRef(false);

  const resolve = async (code: string) => {
    if (!code.trim()) return;
    setStage({ kind: 'loading' });
    setManualCode('');
    try {
      const voucher = await scanMutation.mutateAsync(code.trim());
      setStage({ kind: 'result', voucher });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    } finally {
      busyRef.current = false;
    }
  };

  const handleCameraDecode = (code: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    void resolve(code);
  };

  const handleUploadDecode = (code: string) => {
    void resolve(code);
  };

  const {
    inputRef: qrUploadRef,
    previewUrl,
    status: uploadStatus,
    error: uploadError,
    handleFile: handleQrUpload,
    reset: resetQrUpload,
  } = useQrImageUpload(handleUploadDecode);

  function resetTransient() {
    busyRef.current = false;
    setStage({ kind: 'idle' });
    setManualCode('');
    setConfirmOpen(false);
    resetQrUpload();
  }

  function selectMode(next: InputMode) {
    if (next === mode) return;
    setMode(next);
    resetTransient();
  }

  function scanAnother() {
    resetTransient();
  }

  const confirmRedeem = async () => {
    if (stage.kind !== 'result') return;
    const { code, memberName } = stage.voucher;
    setRedeeming(true);
    try {
      const updated = await redeemMutation.mutateAsync(stage.voucher.id);
      setStage({ kind: 'result', voucher: updated });
      setConfirmOpen(false);
      notifySuccess({
        title: 'Voucher redeemed',
        message: `${code} (${memberName}) redeemed in full.`,
      });
    } catch (e) {
      const message = (e as Error).message;
      setStage({ kind: 'error', message });
      setConfirmOpen(false);
      notifyError({ title: 'Redemption failed', message });
    } finally {
      setRedeeming(false);
    }
  };

  const isActive =
    stage.kind === 'result' &&
    stage.voucher.status === 'ACTIVE' &&
    !isExpired(stage.voucher.expiresAt);

  return (
    <section>
      <PageHeader
        title="Scan Voucher QR"
        description="Point the camera at a member's voucher QR code to verify and redeem it"
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/vouchers')}>
            All Vouchers
          </Button>
        }
      />

      <div className={styles.switcher}>
        <Tabs
          items={INPUT_MODE_TABS}
          value={mode}
          onChange={(value) => selectMode(value as InputMode)}
          baseId="scan-input"
          ariaLabel="Voucher input method"
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.scannerCard}>
          {mode === 'camera' ? (
            <div
              id="scan-input-camera-panel"
              role="tabpanel"
              aria-labelledby="scan-input-camera-tab"
            >
              <CameraView
                onDecode={handleCameraDecode}
                active={stage.kind === 'idle'}
              />
            </div>
          ) : null}

          {mode === 'manual' ? (
            <div
              id="scan-input-manual-panel"
              role="tabpanel"
              aria-labelledby="scan-input-manual-tab"
              className={styles.manualWrap}
            >
              <label htmlFor="scan-manual" className={styles.manualLabel}>
                Enter the code manually:
              </label>
              <div className={styles.manualRow}>
                <input
                  id="scan-manual"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="JAD-VCH-2026-101"
                  aria-label="Voucher code"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void resolve(manualCode);
                  }}
                  className={styles.manualInput}
                />
                <Button
                  variant="primary"
                  onClick={() => void resolve(manualCode)}
                  disabled={!manualCode.trim()}
                >
                  Look up
                </Button>
              </div>
            </div>
          ) : null}

          {mode === 'upload' ? (
            <div
              id="scan-input-upload-panel"
              role="tabpanel"
              aria-labelledby="scan-input-upload-tab"
              className={styles.manualWrap}
            >
              <span className={styles.manualLabel}>Upload a QR image:</span>
              <div className={styles.manualRow}>
                <input
                  ref={qrUploadRef}
                  type="file"
                  accept="image/*"
                  aria-label="Upload QR image"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handleQrUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Uploaded QR preview"
                    className={styles.uploadPreview}
                  />
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() => qrUploadRef.current?.click()}
                  disabled={uploadStatus === 'decoding'}
                >
                  {uploadStatus === 'decoding'
                    ? 'Reading image…'
                    : previewUrl
                      ? 'Upload another'
                      : 'Upload QR'}
                </Button>
                {previewUrl ? (
                  <Button variant="ghost" onClick={resetQrUpload}>
                    Clear
                  </Button>
                ) : null}
              </div>
              {uploadStatus === 'decoding' ? (
                <p role="status" className={styles.uploadHint}>
                  Looking for a QR code in the image…
                </p>
              ) : null}
              {uploadError ? (
                <p role="alert" className={styles.error}>
                  {uploadError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.resultCard} aria-live="polite">
          {stage.kind === 'idle' ? <p className={styles.placeholder}>Waiting for a scan…</p> : null}
          {stage.kind === 'loading' ? (
            <p role="status" className={styles.loadingRow}>
              <Spinner size="sm" /> Looking up voucher…
            </p>
          ) : null}
          {stage.kind === 'error' ? (
            <div className={styles.errorWrap}>
              <p role="alert" className={styles.error}>
                {stage.message}
              </p>
              <Button variant="secondary" onClick={scanAnother}>
                Try again
              </Button>
            </div>
          ) : null}
          {stage.kind === 'result' ? (
            <VoucherResult
              voucher={stage.voucher}
              isActive={isActive}
              onRedeem={() => setConfirmOpen(true)}
              onScanAnother={scanAnother}
            />
          ) : null}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm redemption"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={redeeming}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmRedeem} loading={redeeming}>
              Confirm redeem
            </Button>
          </>
        }
      >
        {stage.kind === 'result' ? (
          <p className={styles.confirmBody}>
            Redeem <strong>{stage.voucher.code}</strong> ({stage.voucher.memberName}) for{' '}
            <strong>{formatMoney(stage.voucher.remainingValue)}</strong>? Remaining value will be
            set to 0.00.
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}

/**
 * Camera pane - mounted only while the Camera tab is active so the stream
 * starts and stops with the tab (unmount cleanup releases the camera). The
 * stream is additionally paused via `active` once a decode resolves, so the
 * viewfinder freezes on the result instead of firing duplicate scans.
 */
function CameraView({ onDecode, active }: { onDecode: (code: string) => void; active: boolean }) {
  const { videoRef, status } = useQrScanner(onDecode, active);
  return (
    <div>
      <div className={styles.viewfinder}>
        <video
          ref={videoRef}
          className={styles.video}
          aria-label="Voucher QR camera view"
          muted
          playsInline
        />
        <span className={`${styles.corner} ${styles.cornerTL}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerTR}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerBL}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.cornerBR}`} aria-hidden="true" />
        <div className={styles.scanLine} aria-hidden="true" />
        <div className={styles.statusOverlay} aria-hidden="true">
          <StatusChip label={overlayLabel(status)} tone={overlayTone(status)} />
        </div>
      </div>
      <p role="status" className={styles.scannerHint}>
        {scannerHint(status)}
      </p>
    </div>
  );
}

function overlayLabel(status: ScannerStatus): string {
  switch (status.kind) {
    case 'requesting':
      return 'Starting camera';
    case 'running':
      return 'Scanning';
    case 'error':
      return 'Camera unavailable';
    default:
      return 'Camera off';
  }
}

function overlayTone(status: ScannerStatus): 'info' | 'success' | 'warning' | 'neutral' {
  switch (status.kind) {
    case 'requesting':
      return 'info';
    case 'running':
      return 'success';
    case 'error':
      return 'warning';
    default:
      return 'neutral';
  }
}

function scannerHint(status: ScannerStatus): string {
  switch (status.kind) {
    case 'requesting':
      return 'Requesting camera access…';
    case 'running':
      return 'Scanning - keep the QR code inside the view.';
    case 'error':
      return `${status.message} Switch to Manual or Upload to verify a voucher.`;
    default:
      return 'Enable camera to scan, or switch to Manual or Upload.';
  }
}

function VoucherResult({
  voucher,
  isActive,
  onRedeem,
  onScanAnother,
}: {
  voucher: VoucherAssignment;
  isActive: boolean;
  onRedeem: () => void;
  onScanAnother: () => void;
}) {
  const resultRef = useRef<HTMLDivElement>(null);

  // Move focus to the result when it arrives (screen-reader announcement).
  useEffect(() => {
    resultRef.current?.focus();
  }, []);

  const expired = voucher.status === 'ACTIVE' && isExpired(voucher.expiresAt);
  const redeemed = voucher.status === 'FULLY_REDEEMED';

  return (
    <div ref={resultRef} tabIndex={-1} className={styles.result} data-testid="scan-result">
      <QrCode value={voucher.code} size={96} alt={`QR code for ${voucher.code}`} />
      <div className={styles.resultMeta}>
        <div className={styles.resultHead}>
          <span className={styles.avatar} aria-hidden="true">
            {getInitials(voucher.memberName)}
          </span>
          <div className={styles.resultHeadText}>
            <span className={styles.memberName}>{voucher.memberName}</span>
            <span className={styles.code}>{voucher.code}</span>
          </div>
        </div>
        <span className={styles.title}>{voucher.title}</span>
        <span className={styles.value}>{formatMoney(voucher.remainingValue)}</span>
        <div className={styles.chips}>
          <StatusChip
            label={VOUCHER_STATUS_LABEL[voucher.status]}
            tone={VOUCHER_STATUS_TONE[voucher.status]}
          />
          {isActive ? <StatusChip label="Verified" tone="success" /> : null}
          {expired ? <StatusChip label="Expired" tone="warning" /> : null}
        </div>
        {redeemed ? (
          <p className={styles.success}>
            Redeemed{voucher.redeemedAt ? ` on ${formatDate(voucher.redeemedAt)}` : ''} - remaining
            value is 0.00.
          </p>
        ) : null}
        <span className={styles.issued}>Issued {formatDate(voucher.createdAt)}</span>
        {voucher.expiresAt ? (
          <span className={styles.issued}>Expires {formatDate(voucher.expiresAt)}</span>
        ) : null}
        {isActive ? (
          <>
            <Button variant="primary" onClick={onRedeem} className={styles.redeemButton}>
              Redeem voucher
            </Button>
            <Button variant="ghost" onClick={onScanAnother} className={styles.redeemButton}>
              Scan another
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onScanAnother} className={styles.redeemButton}>
            Scan another
          </Button>
        )}
      </div>
    </div>
  );
}
