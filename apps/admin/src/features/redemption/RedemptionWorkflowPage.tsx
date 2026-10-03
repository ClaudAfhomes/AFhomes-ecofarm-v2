import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, Spinner, StatusChip } from '@jad/ui';
import type { RedemptionItem, RedemptionPreview, RedemptionReceipt } from '@jad/contracts';

import { useSession } from '../../lib/session';
import { ApiError } from '../../lib/api/errors';
import {
  getRedemptionItems,
  newTransactionReference,
  redeemPoints,
  resolveMember,
} from './services';
import { useQrScanner } from './useQrScanner';
import styles from './RedemptionWorkflow.module.css';

/**
 * The staff redemption workflow: identify, price, confirm.
 *
 * SCANNING NEVER DEDUCTS ANYTHING. Resolving a member only reads; the points
 * move in exactly one place, on confirm, inside one server-side transaction.
 * That separation is deliberate: a member is routinely scanned more than once
 * while an item is chosen, and a scan must never be able to spend their points.
 *
 * The price and the balance shown here are the SERVER's figures, echoed back
 * from the commit. Nothing on this screen computes a total, because a total the
 * browser produced could disagree with the ledger.
 *
 * NO NFC. The two identifiers are a camera image and a typed code.
 */
export function RedemptionWorkflowPage() {
  const { user } = useSession();
  const client = useQueryClient();

  const [manualCode, setManualCode] = useState('');
  const [preview, setPreview] = useState<RedemptionPreview | null>(null);
  const [itemId, setItemId] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  /** Item whose details are open. Reading details never selects or redeems. */
  const [detailsItem, setDetailsItem] = useState<RedemptionItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [receipt, setReceipt] = useState<RedemptionReceipt | null>(null);
  const [scanning, setScanning] = useState(false);
  /** One reference per INTENDED transaction, reused by every retry of it. */
  const [reference, setReference] = useState(() => newTransactionReference());

  const catalog = useQuery({
    queryKey: ['redemption', 'items'],
    queryFn: () => getRedemptionItems(false),
  });

  const lookup = useMutation({
    mutationFn: resolveMember,
    onSuccess: (found) => {
      setPreview(found);
      setItemId('');
      setItemFilter('');
      setQuantity(1);
      // A new member means a new intended transaction.
      setReference(newTransactionReference());
    },
  });

  const onDecoded = useCallback(
    (value: string) => {
      setScanning(false);
      lookup.mutate(value);
    },
    [lookup],
  );
  const scanner = useQrScanner(onDecoded);
  const {
    status: scanStatus,
    message: scanMessage,
    videoRef,
    start: startScan,
    stop: stopScan,
  } = scanner;

  const redeem = useMutation({
    mutationFn: redeemPoints,
    onSuccess: (result) => {
      setReceipt(result);
      void client.invalidateQueries({ queryKey: ['redemption', 'history'] });
      // Employee Reports (`['reports', 'redemptions', …]`) must show the new
      // service transaction - and its updated summary cards - without reload.
      void client.invalidateQueries({ queryKey: ['reports'] });
      // The member preview balance shown at the till is now stale.
      setPreview(null);
    },
  });

  const selectedItem = useMemo(
    () => catalog.data?.find((item) => item.id === itemId) ?? null,
    [catalog.data, itemId],
  );

  // Client-side filter over the fetched ACTIVE catalog. The server remains
  // authoritative: this only narrows what the till displays, never what a
  // redemption may cost or whether it is allowed.
  const needle = itemFilter.trim().toLowerCase();
  const visibleItems = (catalog.data ?? []).filter(
    (item) =>
      needle.length === 0 ||
      `${item.name} ${item.code} ${item.category}`.toLowerCase().includes(needle),
  );

  const reset = () => {
    setPreview(null);
    setItemId('');
    setItemFilter('');
    setQuantity(1);
    setManualCode('');
    setReceipt(null);
    lookup.reset();
    redeem.reset();
    setReference(newTransactionReference());
  };

  // While the receipt is open, printing shows the receipt alone. The class is
  // removed the moment the dialog closes or the till resets, so a later print
  // from anywhere else is never affected.
  useEffect(() => {
    if (receipt === null) return;
    document.body.classList.add('afh-print-receipt');
    return () => {
      document.body.classList.remove('afh-print-receipt');
    };
  }, [receipt]);

  const printReceipt = () => {
    if (typeof window.print === 'function') window.print();
  };

  const canAfford =
    preview !== null &&
    selectedItem !== null &&
    preview.pointsBalance >= selectedItem.pointsCost * quantity;
  const affordable = preview !== null && selectedItem !== null && canAfford;

  return (
    <>
      <PageHeader
        title="Redeem Points"
        description="Scan a member's QR code or enter their member code, choose an item, then confirm."
      />
      <p className={styles.hint}>
        The catalog below is the shared admin catalog - items created by an administrator appear
        here automatically. <Link to="/admin/redemption/history">Transaction history</Link>
      </p>

      {/* ---------------- 1. identify ---------------- */}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>1. Identify the member</h2>

        <div className={styles.identifyRow}>
          <div className={styles.manual}>
            <label className={styles.label} htmlFor="redemption-code">
              Member code
            </label>
            <div className={styles.manualRow}>
              <input
                id="redemption-code"
                name="redemption-code"
                className={styles.input}
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="MBS-000001 or AFH-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && manualCode.trim().length >= 4) {
                    lookup.mutate(manualCode);
                  }
                }}
              />
              <Button
                onClick={() => lookup.mutate(manualCode)}
                disabled={manualCode.trim().length < 4 || lookup.isPending}
              >
                {lookup.isPending ? 'Looking up…' : 'Look up'}
              </Button>
            </div>
            <p className={styles.hint}>
              The member code from the digital VIP card, a fallback code, or a scanned QR all
              identify the same membership.
            </p>
          </div>

          <div className={styles.divider} aria-hidden="true">
            or
          </div>

          <div className={styles.scan}>
            <Button
              variant="secondary"
              onClick={() => {
                setScanning((open) => !open);
                if (scanning) stopScan();
                else startScan();
              }}
              disabled={lookup.isPending}
            >
              {scanning ? 'Stop camera' : 'Scan QR code'}
            </Button>
            {scanning && (
              <>
                {/* A camera preview, not a media player: it has no audio, no
                    controls and no captions, and the frame is never stored. */}
                <video
                  className={styles.video}
                  ref={videoRef}
                  muted
                  playsInline
                  aria-label="Camera preview for scanning a member QR code"
                />
                {scanStatus === 'scanning' && (
                  <p className={styles.hint} role="status">
                    Point the camera at the member&apos;s QR code.
                  </p>
                )}
                {scanMessage && (
                  <p className={styles.warning} role="alert">
                    {scanMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {lookup.isError && (
          <ErrorState
            title="Could not identify that member"
            message={
              lookup.error instanceof ApiError && lookup.error.status === 404
                ? 'No membership matches that code. Check it with the member, or ask them to use the code printed on their card.'
                : 'The lookup failed. Try again in a moment.'
            }
          />
        )}
        {lookup.isPending && (
          <p className={styles.hint} role="status">
            <Spinner label="Looking up the member" size="sm" /> Looking up…
          </p>
        )}
      </section>

      {/* ---------------- 2. price ---------------- */}
      {preview && (
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>2. Choose what to redeem</h2>

          <div className={styles.memberCard}>
            <div>
              <p className={styles.memberName}>{preview.customerDisplayName}</p>
              <p className={styles.memberMeta}>
                {preview.membershipNumber} · {preview.productName ?? 'AF Homes card'}
              </p>
            </div>
            <div className={styles.memberRight}>
              <StatusChip
                label={preview.membershipStatus}
                tone={preview.redeemable ? 'success' : 'warning'}
              />
              <p className={styles.balance}>
                {preview.pointsBalance.toLocaleString('en-PH')} points
              </p>
            </div>
          </div>

          {preview.matchedBy === 'qr' && <p className={styles.hint}>Identified by QR code.</p>}
          {preview.matchedBy === 'fallback_code' && (
            <p className={styles.hint}>Identified by fallback member code.</p>
          )}
          {preview.matchedBy === 'card_number' && (
            <p className={styles.hint}>Identified by member code.</p>
          )}

          {!preview.redeemable && (
            <div className={styles.blocked} role="alert">
              <strong>This member cannot be redeemed against right now.</strong>
              <br />
              {preview.blockedReason}
            </div>
          )}

          {catalog.isError && <ErrorState title="The catalog could not be loaded" />}
          {catalog.isLoading && <p className={styles.hint}>Loading items…</p>}
          {catalog.data && catalog.data.length === 0 && (
            <EmptyState
              title="No items are available"
              description="An administrator needs to add redemption items before points can be redeemed."
            />
          )}

          {catalog.data && catalog.data.length > 0 && (
            <>
              <label className={styles.label} htmlFor="redemption-item-filter">
                Filter items
              </label>
              <input
                id="redemption-item-filter"
                name="redemption-item-filter"
                value={itemFilter}
                onChange={(event) => setItemFilter(event.target.value)}
                placeholder="Name, code or category"
                autoComplete="off"
              />
              <ul className={styles.items} role="radiogroup" aria-label="Redemption items">
                {visibleItems.map((item) => {
                  const unaffordable = preview.pointsBalance < item.pointsCost;
                  return (
                    <li key={item.id}>
                      <label className={`${styles.item} ${unaffordable ? styles.itemDim : ''}`}>
                        <input
                          type="radio"
                          name="redemption-item"
                          value={item.id}
                          checked={itemId === item.id}
                          disabled={!preview.redeemable}
                          onChange={() => setItemId(item.id)}
                        />
                        <span className={styles.itemBody}>
                          <span className={styles.itemName}>{item.name}</span>
                          <span className={styles.itemCode}>{item.code}</span>
                          {item.description && (
                            <span className={styles.itemDescription}>{item.description}</span>
                          )}
                        </span>
                        <span className={styles.itemCost}>
                          {item.pointsCost.toLocaleString('en-PH')}
                        </span>
                      </label>
                      <Button variant="secondary" onClick={() => setDetailsItem(item)}>
                        Details
                      </Button>
                    </li>
                  );
                })}
              </ul>

              {selectedItem && (
                <div className={styles.confirm}>
                  <div className={styles.quantity}>
                    <label className={styles.label} htmlFor="redemption-quantity">
                      Quantity
                    </label>
                    <input
                      id="redemption-quantity"
                      name="redemption-quantity"
                      className={styles.quantityInput}
                      type="number"
                      min={1}
                      max={99}
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(Math.min(99, Math.max(1, Number(event.target.value) || 1)))
                      }
                    />
                  </div>
                  <dl className={styles.summary}>
                    <div>
                      <dt>Item</dt>
                      <dd>{selectedItem.name}</dd>
                    </div>
                    <div>
                      <dt>Points cost</dt>
                      <dd>{(selectedItem.pointsCost * quantity).toLocaleString('en-PH')}</dd>
                    </div>
                    <div>
                      <dt>Current balance</dt>
                      <dd>{preview.pointsBalance.toLocaleString('en-PH')}</dd>
                    </div>
                    <div>
                      <dt>Balance after</dt>
                      <dd className={affordable ? styles.afterOk : styles.afterBad}>
                        {(
                          preview.pointsBalance -
                          selectedItem.pointsCost * quantity
                        ).toLocaleString('en-PH')}
                      </dd>
                    </div>
                  </dl>

                  {!canAfford && (
                    <p className={styles.warning} role="alert">
                      The member does not have enough points for this item.
                    </p>
                  )}

                  {redeem.isError && (
                    <ErrorState
                      title="The redemption was not completed"
                      message={
                        redeem.error instanceof ApiError
                          ? redeem.error.message
                          : 'Nothing was deducted. Try again.'
                      }
                    />
                  )}

                  <div className={styles.actions}>
                    <Button variant="secondary" onClick={reset}>
                      Clear
                    </Button>
                    <Button
                      disabled={!canAfford || redeem.isPending}
                      onClick={() =>
                        redeem.mutate({
                          membershipId: preview.membershipId,
                          redemptionItemId: selectedItem!.id,
                          quantity,
                          clientTransactionId: reference,
                        })
                      }
                    >
                      {redeem.isPending
                        ? 'Redeeming…'
                        : `Confirm redemption of ${(selectedItem.pointsCost * quantity).toLocaleString('en-PH')} points`}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ---------------- item details ---------------- */}
      <Dialog
        open={detailsItem !== null}
        onClose={() => setDetailsItem(null)}
        title={detailsItem ? detailsItem.name : 'Item details'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetailsItem(null)}>
              Close
            </Button>
            {detailsItem && (
              <Button
                disabled={!preview?.redeemable}
                onClick={() => {
                  setItemId(detailsItem.id);
                  setDetailsItem(null);
                }}
              >
                Select this item
              </Button>
            )}
          </>
        }
      >
        {detailsItem && (
          <dl className={styles.summary}>
            <div>
              <dt>Item</dt>
              <dd>{detailsItem.name}</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>{detailsItem.code}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{detailsItem.category}</dd>
            </div>
            <div>
              <dt>Points cost</dt>
              <dd>{detailsItem.pointsCost.toLocaleString('en-PH')}</dd>
            </div>
            {detailsItem.description && (
              <div>
                <dt>Description</dt>
                <dd>{detailsItem.description}</dd>
              </div>
            )}
            <div>
              <dt>Availability</dt>
              <dd>{detailsItem.isActive ? 'Available' : 'No longer available'}</dd>
            </div>
          </dl>
        )}
      </Dialog>

      {/* ---------------- 3. receipt ---------------- */}
      <Dialog
        open={receipt !== null}
        onClose={reset}
        title="Redemption complete"
        footer={
          <>
            <Button variant="secondary" onClick={printReceipt}>
              Print receipt
            </Button>
            <Button size="lg" onClick={reset}>
              New Transaction
            </Button>
          </>
        }
      >
        {receipt && (
          <div className={styles.receipt}>
            <p className={styles.receiptNumber}>{receipt.redemptionNumber}</p>
            <dl className={styles.receiptList}>
              <div>
                <dt>Member</dt>
                <dd>{receipt.customerDisplayName}</dd>
              </div>
              <div>
                <dt>Membership</dt>
                <dd>{receipt.membershipNumber}</dd>
              </div>
              <div>
                <dt>Item</dt>
                <dd>
                  {receipt.itemName}
                  {receipt.quantity > 1 ? ` × ${receipt.quantity}` : ''}
                </dd>
              </div>
              <div>
                <dt>Points spent</dt>
                <dd>{receipt.totalPoints.toLocaleString('en-PH')}</dd>
              </div>
              <div>
                <dt>Balance before</dt>
                <dd>{receipt.balanceBefore.toLocaleString('en-PH')}</dd>
              </div>
              <div>
                <dt>Balance after</dt>
                <dd>{receipt.balanceAfter.toLocaleString('en-PH')}</dd>
              </div>
              <div>
                <dt>Served by</dt>
                <dd>{receipt.redeemedByName}</dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>{new Date(receipt.completedAt).toLocaleString('en-PH')}</dd>
              </div>
            </dl>
            {receipt.replayed && (
              <p className={styles.warning} role="status">
                This was a repeat of a transaction already recorded, so nothing was deducted twice.
              </p>
            )}
          </div>
        )}
      </Dialog>

      {user &&
        !user.afHomesPermissions.some(
          (p) => p.moduleKey === 'operations.redemption' && p.canCreate,
        ) && (
          <div className={styles.blocked} role="alert">
            You can look members up, but your role cannot create redemptions. Ask an administrator
            if you need this permission.
          </div>
        )}
    </>
  );
}
