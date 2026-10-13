import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  MetricCard,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';
import styles from './points.module.css';
import { TierBadge } from './TierBadge';
import { useQrScanner } from '../redemption/useQrScanner';
import { ClaimQr, type IssuedClaim } from './ClaimQr';
import {
  resolveMemberIdentifier,
  type PricedPurchase,
  getSettlement,
  recordPurchaseReceipt,
} from './points-services';
import { newTransactionReference } from '../redemption/services';

/** Narrow, so a bad resolve response cannot flow into the purchase payload. */
type ResolvedMember = {
  membershipId: string;
  membershipNumber: string;
  customerDisplayName: string;
  productName: string | null;
  pointsBalance: number;
  expired: boolean;
};

import {
  adjustPoints,
  completePurchase,
  issueEarningClaim,
  listServices,
  listOwnPurchases,
  recordPurchase,
  reversePurchasePoints,
} from './points-services';
import { earningKeys } from './queryKeys';

/**
 * Staff points-earning screen: record a purchase, then issue the member a claim.
 *
 * The order of operations is not a UI preference, it is the system's own gate:
 *
 *   1. Record the purchase with its lines. The gross is computed by the server
 *      from those lines, so this screen never sends a total.
 *   2. Settle it. Verified receipts must cover the NET amount; an unsettled
 *      purchase can never earn, and the server refuses a claim for it.
 *   3. Issue the claim. The member's code is displayed EXACTLY ONCE here.
 *
 * Nothing on this screen can award points by itself. Every figure the member
 * ends up with is decided by a server function reading the rule, the tier and the
 * remaining capacity, and every staff identity is the session's, never a field.
 */
export function BusinessPointsPage() {
  const client = useQueryClient();
  const mayCorrect =
    useSession().user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'operations.redemption' && p.canUpdate,
    ) === true;
  const services = useQuery({
    queryKey: earningKeys.services,
    queryFn: listServices,
    placeholderData: keepPreviousData,
  });

  const [member, setMember] = useState<ResolvedMember | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
  /**
   * The sale-time discount choice. Checked means today's behavior: the VIP tier
   * rate applies and is snapshotted. Unchecked records a points-path sale with
   * no tier figures, so points may later discount it without a stacking
   * promotion. Immutable once recorded: unchecking after the fact changes
   * nothing, and the server refuses a stacked spend either way.
   */
  const [applyTier, setApplyTier] = useState(true);
  const [issued, setIssued] = useState<IssuedClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  /**
   * One identifier in, one membership out.
   *
   * Both the camera and the typed code go through the SAME call, so there is no
   * way for the scan path and the keyboard path to disagree about which cards are
   * valid. Scanning is only ever a way of TYPING the code faster - it grants
   * nothing extra.
   */
  const identify = useBusinessMutation({
    // Wrapped, not passed by reference: TanStack Query hands `mutationFn` a
    // second context argument, and a service function must never be handed one.
    mutationFn: (code: string) => resolveMemberIdentifier(code),
    onSuccess: (found) => {
      setMember(found);
      setResolveError(null);
      setManualCode('');
    },
    onError: (cause: unknown) => {
      setMember(null);
      setResolveError(
        cause instanceof Error && cause.message
          ? 'That card is not recognised. Check the code and try again.'
          : 'That card is not recognised.',
      );
    },
  });

  // Destructured, exactly as RedemptionWorkflowPage does: the react-compiler lint
  // cannot prove the returned callback ref is stable while it is reached through
  // an object.
  const {
    status: scanStatus,
    message: scanMessage,
    videoRef,
    start: startScan,
  } = useQrScanner((value) => identify.mutate(value));

  // The gross is never sent from here: the server recomputes it from the lines, so
  // the only figure this screen contributes is the per-line unit price from the
  // catalog, and even that is re-read server-side.
  const recordPurchaseFor = () =>
    recordPurchase({
      membershipId: member?.membershipId ?? '',
      // The idempotency key for the whole sale. Stable for this screen, so a
      // retried request is the SAME sale rather than a second purchase.
      reference,
      // The member's discount path for this sale. Sent explicitly so the choice
      // is visible; omitted would silently default to the tier rate.
      applyTierDiscount: applyTier,
      lines: [
        {
          serviceId,
          quantity: Number(quantity) || 1,
          unitAmount: services.data?.find((s) => s.id === serviceId)?.basePrice ?? '0.00',
        },
      ],
    });

  const record = useBusinessMutation({
    mutationFn: recordPurchaseFor,
  });
  const complete = useBusinessMutation({
    mutationFn: (purchaseId: string) => completePurchase(purchaseId),
    onSuccess: () => client.invalidateQueries({ queryKey: earningKeys.all }),
  });
  /** Re-reads settlement from the server after a state change. */
  const refresh = () => client.invalidateQueries({ queryKey: earningKeys.all });

  const claim = useBusinessMutation({
    mutationFn: (purchaseId: string) => issueEarningClaim(purchaseId),
    onSuccess: (result) => {
      // The whole issued claim, so the dialog can render the QR. Component state
      // only: never cached, never a query key, gone with the dialog - because the
      // server keeps only a hash of the credential. It is only reachable once
      // the server has reported the sale claimable.
      setIssued({
        claimNumber: result.claimNumber,
        qrToken: result.qrToken ?? '',
        fallbackCode: result.fallbackCode ?? '',
        expiresAt: result.expiresAt,
      });
      setError(null);
      notifySuccess({ title: `Claim ${result.claimNumber} issued` });
      client.invalidateQueries({ queryKey: earningKeys.all });
    },
  });

  const ownPurchases = useQuery({
    queryKey: earningKeys.ownPurchases,
    queryFn: listOwnPurchases,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const resumable = (ownPurchases.data ?? []).filter(
    (purchase) =>
      (!member || purchase.membershipId === member.membershipId) &&
      purchase.status !== 'reversed' &&
      !purchase.claimStatus,
  );
  const [lastPurchase, setLastPurchase] = useState<string | null>(null);
  /**
   * What the SERVER priced. Held so the GSD can show the member the gross, the
   * VIP discount and the net they are actually paying.
   *
   * This is a PREVIEW of the figures the database computed, never an input to
   * them: nothing here is sent back, and the receipt the GSD records is the net
   * this screen displays, not one it computed.
   */
  const [priced, setPriced] = useState<PricedPurchase | null>(null);

  /**
   * Settlement is POLLED, not asserted locally.
   *
   * Finance verifies in another screen and another session, so the state this
   * screen shows has to come from the server rather than from what this browser
   * last did. Polling is the cross-session channel here: browser roles hold no
   * table privileges to subscribe with.
   */
  const settlement = useQuery({
    queryKey: earningKeys.settlement(lastPurchase),
    queryFn: () => getSettlement(lastPurchase as string),
    enabled: Boolean(lastPurchase),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  /**
   * The POS reference for THIS sale, generated once per intended transaction.
   *
   * It is the idempotency key for the whole sale: a retried request carrying the
   * same reference is recognised as the same purchase server-side instead of
   * recording a second one. Generating a new one per click would turn every
   * double-click into two real sales.
   */
  const [reference] = useState(() => newTransactionReference());
  /**
   * The RECEIPT reference, derived from the sale reference.
   *
   * It is stable for the life of this screen so a retried "record the receipt"
   * is the same receipt rather than a second row of cash. Derived rather than
   * freshly generated, because a reference generated per click would make every
   * double-click a second, real receipt.
   */
  const receiptReference = `${reference}-rcpt`;

  const receipt = useBusinessMutation({
    mutationFn: (args: { purchaseId: string; amount: string }) =>
      recordPurchaseReceipt({
        purchaseId: args.purchaseId,
        amount: args.amount,
        method: 'cash',
        reference: receiptReference,
      }),
    onSuccess: () => {
      notifySuccess({ title: 'Receipt recorded, pending Finance verification' });
      client.invalidateQueries({ queryKey: earningKeys.all });
    },
  });

  const reverse = useBusinessMutation({
    mutationFn: (reason: string) =>
      reversePurchasePoints({ purchaseId: lastPurchase ?? '', reason }),
    onSuccess: () => {
      notifySuccess({ title: 'Purchase points reversed' });
      setLastPurchase(null);
      client.invalidateQueries({ queryKey: earningKeys.all });
    },
  });
  const [reverseOpen, setReverseOpen] = useState(false);
  const busy = record.isPending || receipt.isPending;

  /**
   * Record the sale, then STOP.
   *
   * The previous screen did record -> complete -> claim in one click. That could
   * never work for a real sale: `complete_purchase` refuses unless VERIFIED
   * receipts already cover the net, and the seller is deliberately forbidden
   * from verifying. So the one-click flow either failed outright or, worse,
   * taught staff that "complete" meant "money received" when it did not.
   *
   * Completion and the claim now happen only once Finance has verified the
   * money, and the screen says so rather than implying otherwise.
   */
  const recordSale = async () => {
    if (busy) return;
    setError(null);
    setIssued(null);
    try {
      const purchase = await record.mutateAsync();
      setPriced(purchase);
      setLastPurchase(purchase.purchaseId);
    } catch (cause) {
      setError(message(cause));
    }
  };

  // First load skeletonizes the whole page so no static content flashes
  // before the data it describes. Refetches keep previous data visible via
  // keepPreviousData and never reach this branch.
  if (services.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading services"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 440 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 180 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading services</span>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Elite Service Delivery"
        description="Scan the member's card, record the purchase, and issue their claim code."
      />

      <section aria-label="Resume sale" className={styles.section}>
        {ownPurchases.isPending && (
          <div role="status" aria-label="Loading sales" aria-busy="true">
            <Skeleton />
          </div>
        )}
        {ownPurchases.isError && (
          <ErrorState error={ownPurchases.error} onRetry={() => void ownPurchases.refetch()} />
        )}
        {resumable.length > 0 && (
          <>
            <label htmlFor="earning-resume">Resume an existing sale</label>
            <Select
              id="earning-resume"
              value={lastPurchase ?? ''}
              onChange={(event) => {
                const purchase = resumable.find((row) => row.id === event.target.value);
                if (!purchase) return;
                setLastPurchase(purchase.id);
                setPriced({
                  purchaseId: purchase.id,
                  purchaseNumber: purchase.purchaseNumber,
                  grossAmount: purchase.grossAmount,
                  tierDiscountAmount: purchase.tierDiscountAmount,
                  pointsDiscountAmount: purchase.pointsDiscountAmount,
                  netAmount: purchase.netAmount,
                });
              }}
              options={[
                { value: '', label: 'Choose a sale' },
                ...resumable.map((purchase) => ({
                  value: purchase.id,
                  label: `${purchase.purchaseNumber} - ${formatMoneyOrDash(purchase.netAmount)}`,
                })),
              ]}
            />
          </>
        )}
      </section>
      <section aria-label="Identify the member" className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Identify the member</h2>

        <Button variant="secondary" onClick={() => startScan()}>
          Scan the member&apos;s card
        </Button>
        <video
          ref={videoRef}
          className={styles.scanVideo}
          data-scanning={scanStatus === 'scanning'}
          aria-label="Card scanner"
        />
        {scanMessage && <p role="status">{scanMessage}</p>}

        <TextField
          id="earning-manual"
          name="manualCode"
          label="Or type the member code"
          optional
          value={manualCode}
          onChange={setManualCode}
          disabled={identify.isPending}
        />
        <Button
          variant="secondary"
          disabled={!manualCode.trim()}
          loading={identify.isPending}
          loadingLabel="Checking…"
          onClick={() => identify.mutate(manualCode.trim())}
        >
          Find member
        </Button>

        {resolveError && <ErrorState title="Not recognised" message={resolveError} />}

        {member && (
          <div aria-busy={identify.isPending} className={styles.memberCard}>
            <h3 className={styles.memberName}>{member.customerDisplayName}</h3>
            <ul className={styles.metrics} aria-label="Member summary">
              <li>
                <MetricCard
                  label="Membership"
                  value={member.membershipNumber}
                  icon="user-check"
                  chip={{
                    label: member.expired ? 'Expired' : 'Active',
                    tone: member.expired ? 'danger' : 'success',
                  }}
                />
              </li>
              <li>
                <MetricCard
                  label="Points balance"
                  value={formatCountOrDash(member.pointsBalance)}
                  icon="grid"
                  description="Lifetime earning balance"
                />
              </li>
            </ul>
            <p className={styles.hint}>
              Tier: <TierBadge tier={member.productName} />
            </p>
            {member.expired && (
              <Alert variant="danger" title="Membership expired">
                This membership has expired. Points cannot be earned on it.
              </Alert>
            )}
          </div>
        )}
      </section>

      {member && !member.expired && (
        <section aria-label="Record a purchase" className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Record the purchase</h2>

          {/* A Skeleton is aria-hidden, so the ANNOUNCEMENT lives on the region.
              This waits on `isLoading`, not `isPending`: the catalog query is not
              disabled, but a skeleton gated on `isPending` is one refactor away
              from hanging forever on a query that never runs. */}
          {services.isLoading && (
            <div role="status" aria-label="Loading services" aria-busy="true">
              <Skeleton />
              <Skeleton />
            </div>
          )}
          {services.isError && (
            <ErrorState
              error={services.error}
              onRetry={() => void services.refetch()}
              title="Services unavailable"
            />
          )}

          {services.data && services.data.length === 0 && (
            <EmptyState
              title="No services yet"
              description="Add a service and an earning rule before recording a purchase."
            />
          )}

          {services.data && services.data.length > 0 && (
            <>
              <label htmlFor="earning-service">Service</label>
              <Select
                id="earning-service"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                options={[
                  { value: '', label: 'Choose a service' },
                  ...services.data
                    .filter((service) => service.isActive && service.availability === 'available')
                    .map((service) => ({
                      value: service.id,
                      label: `${service.name} (${formatMoneyOrDash(service.basePrice)})`,
                    })),
                ]}
              />

              {services.data.find((service) => service.id === serviceId) && (
                <p>
                  Price and points apply per{' '}
                  {services.data.find((service) => service.id === serviceId)?.pricingUnit ?? 'unit'}
                  . Enter the number of those units.
                </p>
              )}
              <label htmlFor="earning-quantity">Quantity</label>
              <input
                id="earning-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={applyTier}
                  onChange={(event) => setApplyTier(event.target.checked)}
                />
                Apply the VIP tier discount
              </label>
              <p className={styles.hint}>
                {applyTier
                  ? 'The tier rate is snapshotted onto the sale. Points can only discount it later through an explicit stacking promotion.'
                  : 'No tier discount is recorded, so the member may later use points on this sale without a stacking promotion.'}
              </p>

              {/* `aria-busy` on the region, and the Button's own `loading` supplies
                the spinner, the `aria-busy` and the `role="status"` label. The
                `busy` guard in `recordSale` is what actually stops a double submit:
                a disabled button alone is not idempotency, and the server-side POS
                reference is the real protection against a recorded twice. */}
              <div aria-busy={busy}>
                <Button
                  onClick={recordSale}
                  disabled={!serviceId}
                  loading={record.isPending}
                  loadingLabel="Recording…"
                >
                  3. Record the sale
                </Button>
              </div>
            </>
          )}

          {error && <ErrorState title="Not recorded" message={error} />}
        </section>
      )}

      {priced && (
        /* ---------------------------------------------------------------
         * The sale exists. What the member pays, and what happens next.
         *
         * Gross, each discount and the net are shown SEPARATELY: collapsing
         * them into one "total" would hide the discount the member's tier
         * earned them, and would hide that a points spend and a tier discount
         * are different things.
         * ------------------------------------------------------------ */
        <section aria-label="Sale recorded" aria-live="polite" className={styles.section}>
          <h2 className={styles.sectionTitle}>4. What the member pays</h2>
          <ul className={styles.metrics} aria-label="Sale figures">
            <li>
              <MetricCard
                label="Gross"
                value={formatMoneyOrDash(priced.grossAmount)}
                icon="file-text"
              />
            </li>
            <li>
              <MetricCard
                label="VIP tier discount"
                value={
                  priced.tierDiscountAmount && priced.tierDiscountAmount !== '0.00'
                    ? `- ${formatMoneyOrDash(priced.tierDiscountAmount)}`
                    : 'No tier discount applies'
                }
                icon="grid"
              />
            </li>
            <li>
              <MetricCard
                label="Amount due"
                value={formatMoneyOrDash(priced.netAmount)}
                icon="check"
              />
            </li>
          </ul>
          <dl className={styles.figures}>
            <div>
              <dt>Gross</dt>
              <dd>{formatMoneyOrDash(priced.grossAmount)}</dd>
            </div>
            <div>
              <dt>VIP tier discount</dt>
              <dd>
                {priced.tierDiscountAmount && priced.tierDiscountAmount !== '0.00'
                  ? `- ${formatMoneyOrDash(priced.tierDiscountAmount)}`
                  : 'No tier discount applies'}
              </dd>
            </div>
            <div>
              <dt>Points discount</dt>
              <dd>
                {priced.pointsDiscountAmount && priced.pointsDiscountAmount !== '0.00'
                  ? `- ${formatMoneyOrDash(priced.pointsDiscountAmount)}`
                  : 'No points discount applies'}
              </dd>
            </div>
            <div>
              <dt>Amount due</dt>
              <dd>{formatMoneyOrDash(priced.netAmount)}</dd>
            </div>
          </dl>

          <div aria-busy={receipt.isPending}>
            <Button
              onClick={() =>
                receipt.mutate({ purchaseId: priced.purchaseId, amount: priced.netAmount })
              }
              disabled={
                !settlement.data ||
                settlement.data.status !== 'draft' ||
                settlement.data.recordedTotal !== '0.00' ||
                settlement.data.verifiedTotal !== '0.00'
              }
              loading={receipt.isPending}
              loadingLabel="Recording…"
            >
              5. Record the receipt
            </Button>
          </div>
          {receipt.isError && (
            <ErrorState title="Receipt not recorded" message={message(receipt.error)} />
          )}

          {/* The truth about settlement. This panel exists because the OLD
              screen implied a sale was finished the moment it was recorded. It
              was not, and could not be: completion requires VERIFIED money and
              the seller may not verify. */}
          <h3>Settlement</h3>
          <p role="status">
            {settlement.data?.fullyPaid
              ? 'Verified payment covers the amount due.'
              : 'Pending Finance verification.'}
          </p>
          <Alert
            variant={settlement.data?.fullyPaid ? 'success' : 'warning'}
            title={
              settlement.data?.fullyPaid ? 'Settlement verified' : 'Pending Finance verification'
            }
          >
            A recorded receipt is not money received. Finance verifies it on the Operational
            Services Payments screen, and only then can this sale complete and the member&apos;s
            claim code be issued. You cannot verify your own receipt.
          </Alert>
          <Button
            variant="secondary"
            onClick={() => client.invalidateQueries({ queryKey: earningKeys.settlementScope })}
            loading={settlement.isFetching}
            loadingLabel="Refreshing…"
          >
            Refresh status
          </Button>

          {/* Completion and the claim are separate, later acts. Both are refused
              by the SERVER unless verified money already covers the net, so
              these buttons cannot manufacture a settlement - they can only
              confirm one that Finance has already made possible. */}
          {settlement.data?.status === 'draft' && settlement.data.fullyPaid && (
            <Button
              onClick={() => complete.mutate(lastPurchase as string, { onSuccess: refresh })}
              loading={complete.isPending}
              loadingLabel="Completing…"
            >
              Complete the sale
            </Button>
          )}
          {complete.isError && (
            <ErrorState title="Not completed" message={message(complete.error)} />
          )}

          {settlement.data?.status === 'completed' &&
            settlement.data.fullyPaid &&
            !settlement.data.claimStatus && (
              <Button
                onClick={() => claim.mutate(lastPurchase as string, { onSuccess: refresh })}
                loading={claim.isPending}
                loadingLabel="Issuing…"
              >
                Issue the member’s claim code
              </Button>
            )}
          {claim.isError && <ErrorState title="Claim not issued" message={message(claim.error)} />}
        </section>
      )}

      {settlement.data && (
        <section aria-label="Settlement status" aria-live="polite" className={styles.section}>
          <h2 className={styles.sectionTitle}>Settlement status</h2>
          <dl className={styles.figures}>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusChip label={settlement.data.status} />
              </dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{formatMoneyOrDash(settlement.data.recordedTotal)}</dd>
            </div>
            <div>
              <dt>Verified (money received)</dt>
              <dd>{formatMoneyOrDash(settlement.data.verifiedTotal)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{formatMoneyOrDash(settlement.data.remainingAmount)}</dd>
            </div>
            <div>
              <dt>Claim</dt>
              <dd>
                {settlement.data.claimable
                  ? 'Claimable - issue the member their code below'
                  : settlement.data.claimStatus === 'claimed'
                    ? 'Already claimed by the member'
                    : settlement.data.claimStatus === 'rejected'
                      ? 'Receipt rejected'
                      : 'Not available yet'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {issued && (
        <Dialog
          open
          onClose={() => setIssued(null)}
          title="Claim issued"
          footer={<Button onClick={() => setIssued(null)}>Done</Button>}
        >
          <p>
            This is the ONLY time this code is shown. Give it to the member now - only a hash is
            stored, so it cannot be displayed again and a lost code must be reissued.
          </p>
          <ClaimQr claim={issued} />
        </Dialog>
      )}

      {mayCorrect && member && (
        <section aria-label="Adjustments" className={styles.section}>
          <h2 className={styles.sectionTitle}>Manual adjustment</h2>
          <Alert variant="info" title="Correction only">
            Every adjustment is permanent, audited, and never counts toward the annual earning
            limit.
          </Alert>
          <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
            Adjust a member&apos;s points
          </Button>
        </section>
      )}

      {mayCorrect && adjustOpen && member && (
        <AdjustDialog
          membershipId={member.membershipId}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            setAdjustOpen(false);
            notifySuccess({ title: 'Adjustment recorded' });
            client.invalidateQueries({ queryKey: earningKeys.all });
          }}
        />
      )}

      {mayCorrect && lastPurchase && (
        <section aria-label="Reverse a purchase" className={styles.section}>
          <h2 className={styles.sectionTitle}>Reverse the last purchase</h2>
          <Button variant="danger" onClick={() => setReverseOpen(true)}>
            Reverse points
          </Button>
          <p className={styles.hint}>
            Reversal needs a written reason. The ledger row is never deleted.
          </p>
        </section>
      )}

      {mayCorrect && reverseOpen && (
        <ReverseDialog
          pending={reverse.isPending}
          error={reverse.isError ? message(reverse.error) : null}
          onClose={() => setReverseOpen(false)}
          onConfirm={(reason) => reverse.mutate(reason, { onSuccess: () => setReverseOpen(false) })}
        />
      )}
    </section>
  );
}

/**
 * The manual adjustment.
 *
 * The amount and the reason are the only two inputs. The resulting balance is
 * NEVER accepted from here - the server owns it - so a tampered figure cannot
 * change what a member is left holding.
 */
function AdjustDialog({
  membershipId,
  onClose,
  onSaved,
}: {
  membershipId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const adjust = useBusinessMutation({
    mutationFn: () => adjustPoints({ membershipId, amount: Number(amount), reason }),
    onSuccess: onSaved,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Adjust points"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!amount || !reason}
            loading={adjust.isPending}
            loadingLabel="Saving…"
            onClick={() => adjust.mutate()}
          >
            Save adjustment
          </Button>
        </>
      }
    >
      <div aria-busy={adjust.isPending}>
        <label htmlFor="adjust-amount">Amount (negative to deduct)</label>
        <input
          id="adjust-amount"
          type="number"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField
          id="adjust-reason"
          name="adjustReason"
          label="Reason"
          optional
          value={reason}
          onChange={setReason}
        />
        {adjust.isError && <ErrorState title="Not saved" message={message(adjust.error)} />}
      </div>
    </Dialog>
  );
}

/** Reversal always requires a reason, so it is a dialog and never a bare button. */
function ReverseDialog({
  pending,
  error,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reverse purchase points"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason || pending} onClick={() => onConfirm(reason)}>
            {pending ? 'Reversing…' : 'Reverse'}
          </Button>
        </>
      }
    >
      <div aria-busy={pending}>
        <TextField
          id="reverse-reason"
          name="reverseReason"
          label="Reason"
          optional
          value={reason}
          onChange={setReason}
        />
        <p>
          If the member had already moved the points, the shortfall becomes reversal debt rather
          than a negative balance. Earning is never blocked by debt.
        </p>
        {error && <ErrorState title="Not reversed" message={error} />}
      </div>
    </Dialog>
  );
}

/** One readable line for any failure, without leaking a driver message. */
function message(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text || 'Something went wrong. Please try again.';
}
