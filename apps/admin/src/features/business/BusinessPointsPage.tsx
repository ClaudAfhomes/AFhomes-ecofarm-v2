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
import { resolveMemberIdentifier } from './points-services';

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
      lines: [
        {
          serviceId,
          quantity: Number(quantity) || 1,
          unitAmount: services.data?.find((s) => s.id === serviceId)?.basePrice ?? '0.00',
        },
      ],
    });

  const record = useMutation({ mutationFn: recordPurchaseFor });
  const complete = useMutation({
    mutationFn: (purchaseId: string) => completePurchase(purchaseId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['earning'] }),
  });

  const claim = useMutation({
    mutationFn: (purchaseId: string) => issueEarningClaim(purchaseId),
    onSuccess: (result) => {
      // The whole issued claim, so the dialog can render the QR. Component state
      // only: never cached, never a query key, gone with the dialog - because the
      // server keeps only a hash of the credential.
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
  const busy = record.isPending || complete.isPending || claim.isPending;

  /**
   * Record, settle, then issue - in that order, because the server enforces it.
   *
   * The `busy` guard is not cosmetic. Without it a second click would record the
   * purchase TWICE, and the duplicate is a real second purchase with real lines
   * that could earn points.
   */
  const run = async () => {
    if (busy) return;
    setError(null);
    setIssued(null);
    try {
      const purchase = await record.mutateAsync();
      await complete.mutateAsync(purchase.purchaseId);
      setLastPurchase(purchase.purchaseId);
      await claim.mutateAsync(purchase.purchaseId);
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
                button plus the `busy` guard in `run` stop a double submit, which
                on this flow would mean recording the purchase twice. */}
              <div aria-busy={busy}>
                <Button onClick={run} disabled={busy || !serviceId}>
                  {busy ? 'Working…' : '3. Record, settle and issue claim'}
                </Button>
              </div>
              {busy && <Spinner label="Recording the purchase" />}
            </>
          )}

          {error && <ErrorState title="Not recorded" message={error} />}
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
