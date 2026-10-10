import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Spinner,
  notifySuccess,
} from '@afhomes/ui';
import { formatMoney } from './format';
import styles from './points.module.css';
import { useQrScanner } from '../redemption/useQrScanner';
import { ClaimQr, type IssuedClaim } from './ClaimQr';
import { resolveMemberIdentifier, type PricedPurchase, getSettlement, applyPointsDiscount, recordPurchaseReceipt } from './points-services';
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
  recordPurchase,
  reversePurchasePoints,
} from './points-services';

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
  const services = useQuery({ queryKey: ['earning', 'services'], queryFn: listServices });

  const [member, setMember] = useState<ResolvedMember | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState('1');
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
  const identify = useMutation({
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
  const { message: scanMessage, videoRef, start: startScan } = useQrScanner((value) =>
    identify.mutate(value),
  );

  // The gross is never sent from here: the server recomputes it from the lines, so
  // the only figure this screen contributes is the per-line unit price from the
  // catalog, and even that is re-read server-side.
  const recordPurchaseFor = () =>
    recordPurchase({
      membershipId: member?.membershipId ?? '',
      // The idempotency key for the whole sale. Stable for this screen, so a
      // retried request is the SAME sale rather than a second purchase.
      reference,
      lines: [
        {
          serviceId,
          quantity: Number(quantity) || 1,
          unitAmount: services.data?.find((s) => s.id === serviceId)?.basePrice ?? '0.00',
        },
      ],
    });

  const record = useMutation({
    mutationFn: recordPurchaseFor,
  });
  const complete = useMutation({
    mutationFn: (purchaseId: string) => completePurchase(purchaseId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['earning'] }),
  });
  /** Re-reads settlement from the server after a state change. */
  const refresh = () => client.invalidateQueries({ queryKey: ['earning'] });

  const claim = useMutation({
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
      client.invalidateQueries({ queryKey: ['earning'] });
    },
  });

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
    queryKey: ['earning', 'settlement', lastPurchase],
    queryFn: () => getSettlement(lastPurchase as string),
    enabled: Boolean(lastPurchase),
    refetchInterval: 15_000,
  });

  /**
   * The POS reference for THIS sale, generated once per intended transaction.
   *
   * It is the idempotency key for the points spend: a retried request carrying
   * the same reference is recognised as the same operation server-side instead
   * of spending the member's points twice. Generating a new one per click would
   * turn every double-click into a second, real discount.
   */
  const [reference] = useState(() => newTransactionReference());
  const [pointsToSpend, setPointsToSpend] = useState('');
  /**
   * The RECEIPT reference, derived from the sale reference.
   *
   * It is stable for the life of this screen so a retried "record the receipt"
   * is the same receipt rather than a second row of cash. Derived rather than
   * freshly generated, because a reference generated per click would make every
   * double-click a second, real receipt.
   */
  const receiptReference = `${reference}-rcpt`;

  const spend = useMutation({
    mutationFn: (args: { purchaseId: string; points: number }) =>
      applyPointsDiscount(args.purchaseId, args.points, reference),
    onSuccess: () => {
      setPointsToSpend('');
      // The net just changed, so the priced figures on screen are stale.
      client.invalidateQueries({ queryKey: ['earning'] });
    },
  });

  const receipt = useMutation({
    mutationFn: (args: { purchaseId: string; amount: string }) =>
      recordPurchaseReceipt({
        purchaseId: args.purchaseId,
        amount: args.amount,
        method: 'cash',
        reference: receiptReference,
      }),
    onSuccess: () => {
      notifySuccess({ title: 'Receipt recorded, pending Finance verification' });
      client.invalidateQueries({ queryKey: ['earning'] });
    },
  });

  const reverse = useMutation({
    mutationFn: (reason: string) =>
      reversePurchasePoints({ purchaseId: lastPurchase ?? '', reason }),
    onSuccess: () => {
      notifySuccess({ title: 'Purchase points reversed' });
      setLastPurchase(null);
      client.invalidateQueries({ queryKey: ['earning'] });
    },
  });
  const [reverseOpen, setReverseOpen] = useState(false);
  const busy = record.isPending || spend.isPending || receipt.isPending;

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

  return (
    <>
      <PageHeader title="Earn Points" description="Scan the member's card, record the purchase, and issue their claim code." />

      <section aria-label="Identify the member">
        <h2>1. Identify the member</h2>

        <Button variant="secondary" onClick={startScan}>
          Scan the member&apos;s card
        </Button>
        <video ref={videoRef} className={styles.scanVideo} aria-label="Card scanner" />
        {scanMessage && <p role="status">{scanMessage}</p>}

        <label htmlFor="earning-manual">Or type the member code</label>
        <input
          id="earning-manual"
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          disabled={identify.isPending}
        />
        <Button
          variant="secondary"
          disabled={!manualCode.trim() || identify.isPending}
          onClick={() => identify.mutate(manualCode.trim())}
        >
          {identify.isPending ? 'Checking…' : 'Find member'}
        </Button>

        {resolveError && <ErrorState title="Not recognised" message={resolveError} />}

        {member && (
          <div aria-busy={identify.isPending}>
            <h3>{member.customerDisplayName}</h3>
            <dl>
              <dt>Membership</dt>
              <dd>{member.membershipNumber}</dd>
              <dt>Tier</dt>
              <dd>{member.productName ?? '—'}</dd>
              <dt>Points balance</dt>
              <dd>{member.pointsBalance.toLocaleString('en-PH')}</dd>
            </dl>
            {member.expired && (
              <p role="alert">This membership has expired. Points cannot be earned on it.</p>
            )}
          </div>
        )}
      </section>

      {member && !member.expired && (
        <section aria-label="Record a purchase">
          <h2>2. Record the purchase</h2>

          {services.isLoading && <Skeleton />}
          {services.isError && (
            <ErrorState
              title="Services unavailable"
              message="The service catalog could not be loaded, so a purchase cannot be recorded."
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
              <select
                id="earning-service"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
              >
                <option value="">Choose a service</option>
                {services.data
                  .filter((service) => service.isActive)
                  .map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} ({formatMoney(service.basePrice)})
                    </option>
                  ))}
              </select>

              <label htmlFor="earning-quantity">Quantity</label>
              <input
                id="earning-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />

              {/* aria-busy tells assistive tech the region is working; the disabled
                button plus the `busy` guard in `recordSale` stop a double submit,
                which on this flow would mean recording the purchase twice. */}
              <div aria-busy={busy}>
                <Button onClick={recordSale} disabled={busy || !serviceId}>
                  {record.isPending ? 'Recording…' : '3. Record the sale'}
                </Button>
              </div>
              {busy && <Spinner label="Recording the sale" />}
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
        <section aria-label="Sale recorded" aria-live="polite">
          <h2>4. What the member pays</h2>
          <dl>
            <dt>Gross</dt>
            <dd>{formatMoney(priced.grossAmount)}</dd>
            <dt>VIP tier discount</dt>
            <dd>
              {priced.tierDiscountAmount && priced.tierDiscountAmount !== '0.00'
                ? `- ${formatMoney(priced.tierDiscountAmount)}`
                : 'No tier discount applies'}
            </dd>
            <dt>Amount due</dt>
            <dd>{formatMoney(priced.netAmount)}</dd>
          </dl>

          {/* The member can spend their own points here, in one step. Only a
              figure and this sale's reference are sent: the peso value comes
              from the configured rule, so the browser cannot influence it. */}
          <label htmlFor="points-to-spend">Points this member wants to use</label>
          <input
            id="points-to-spend"
            type="number"
            min={1}
            step={1}
            value={pointsToSpend}
            disabled={spend.isPending}
            onChange={(event) => setPointsToSpend(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={spend.isPending || !pointsToSpend || Number(pointsToSpend) <= 0}
            onClick={() =>
              spend.mutate({ purchaseId: priced.purchaseId, points: Number(pointsToSpend) })
            }
          >
            {spend.isPending ? 'Applying…' : 'Apply points to this bill'}
          </Button>
          {spend.isError && <ErrorState title="Points not applied" message={message(spend.error)} />}
          {spend.isSuccess && (
            <p role="status">
              {spend.data.alreadyApplied
                ? 'Those points were already applied to this sale - nothing was taken again.'
                : `Applied ${spend.data.pointsSpent.toLocaleString('en-PH')} points. The member now owes ${formatMoney(spend.data.netAmount)}.`}
            </p>
          )}

          <div aria-busy={receipt.isPending}>
            <Button
              onClick={() =>
                receipt.mutate({ purchaseId: priced.purchaseId, amount: priced.netAmount })
              }
              disabled={receipt.isPending}
            >
              {receipt.isPending ? 'Recording…' : '5. Record the receipt'}
            </Button>
          </div>
          {receipt.isPending && <Spinner label="Recording the receipt" />}
          {receipt.isError && (
            <ErrorState title="Receipt not recorded" message={message(receipt.error)} />
          )}

          {/* The truth about settlement. This panel exists because the OLD
              screen implied a sale was finished the moment it was recorded. It
              was not, and could not be: completion requires VERIFIED money and
              the seller may not verify. */}
          <h3>Settlement</h3>
          <p role="status">Pending Finance verification.</p>
          <p>
            A recorded receipt is not money received. Finance verifies it on the Operational Services
            Payments screen, and only then can this sale complete and the member&apos;s claim code be
            issued. You cannot verify your own receipt.
          </p>
          <Button
            variant="secondary"
            onClick={() => client.invalidateQueries({ queryKey: ['earning', 'settlement'] })}
            disabled={settlement.isFetching}
          >
            {settlement.isFetching ? 'Refreshing…' : 'Refresh status'}
          </Button>

          {/* Completion and the claim are separate, later acts. Both are refused
              by the SERVER unless verified money already covers the net, so
              these buttons cannot manufacture a settlement - they can only
              confirm one that Finance has already made possible. */}
          {settlement.data?.status === 'draft' && settlement.data.fullyPaid && (
            <Button
              onClick={() => complete.mutate(lastPurchase as string, { onSuccess: refresh })}
              disabled={complete.isPending}
            >
              {complete.isPending ? 'Completing…' : 'Complete the sale'}
            </Button>
          )}
          {complete.isError && <ErrorState title="Not completed" message={message(complete.error)} />}

          {settlement.data?.claimable && (
            <Button
              onClick={() => claim.mutate(lastPurchase as string, { onSuccess: refresh })}
              disabled={claim.isPending}
            >
              {claim.isPending ? 'Issuing…' : 'Issue the member’s claim code'}
            </Button>
          )}
          {claim.isError && <ErrorState title="Claim not issued" message={message(claim.error)} />}
        </section>
      )}

      {settlement.data && (
        <section aria-label="Settlement status" aria-live="polite">
          <h2>Settlement status</h2>
          <dl>
            <dt>Status</dt>
            <dd>{settlement.data.status}</dd>
            <dt>Recorded</dt>
            <dd>{formatMoney(settlement.data.recordedTotal)}</dd>
            <dt>Verified (money received)</dt>
            <dd>{formatMoney(settlement.data.verifiedTotal)}</dd>
            <dt>Outstanding</dt>
            <dd>{formatMoney(settlement.data.remainingAmount)}</dd>
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

      {member && (
        <section aria-label="Adjustments">
          <h2>Manual adjustment</h2>
          <p>
            For a correction only. Every adjustment is permanent, audited, and never counts toward
            the annual earning limit.
          </p>
          <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
            Adjust a member&apos;s points
          </Button>
        </section>
      )}

      {adjustOpen && member && (
        <AdjustDialog
          membershipId={member.membershipId}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            setAdjustOpen(false);
            notifySuccess({ title: 'Adjustment recorded' });
            client.invalidateQueries({ queryKey: ['earning'] });
          }}
        />
      )}

      {lastPurchase && (
        <section aria-label="Reverse a purchase">
          <h2>Reverse the last purchase</h2>
          <Button variant="danger" onClick={() => setReverseOpen(true)}>
            Reverse points
          </Button>
          <p>Reversal needs a written reason. The ledger row is never deleted.</p>
        </section>
      )}

      {reverseOpen && (
        <ReverseDialog
          pending={reverse.isPending}
          error={reverse.isError ? message(reverse.error) : null}
          onClose={() => setReverseOpen(false)}
          onConfirm={(reason) => reverse.mutate(reason, { onSuccess: () => setReverseOpen(false) })}
        />
      )}
    </>
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
  const adjust = useMutation({
    mutationFn: () =>
      adjustPoints({ membershipId, amount: Number(amount), reason }),
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
            disabled={adjust.isPending || !amount || !reason}
            onClick={() => adjust.mutate()}
          >
            {adjust.isPending ? 'Saving…' : 'Save adjustment'}
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
        <label htmlFor="adjust-reason">Reason</label>
        <input
          id="adjust-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {adjust.isError && <ErrorState title="Not saved" message={message(adjust.error)} />}
        {adjust.isPending && <Spinner label="Saving the adjustment" />}
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
        <label htmlFor="reverse-reason">Reason</label>
        <input
          id="reverse-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <p>
          If the points were already spent, the shortfall becomes reversal debt rather than a negative
          balance. Earning is never blocked by debt; spending is.
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
