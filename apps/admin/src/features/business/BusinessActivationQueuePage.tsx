import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import { paymentSchemeLabel, type ActivationResult, type FinanceQueueItem } from '@jad/contracts';

import { formatDateTime } from '../../lib/format';
import { SPOT_CASH_LABEL, SPOT_CASH_TONE, formatMoney, formatPoints } from './format';
import { activateSale, getActivationQueue, getCommissions, qualifyCommission } from './services';

/**
 * Activation queue.
 *
 * A membership becomes active only through the server's activation transition,
 * which re-checks that VERIFIED payments reach the snapshotted price inside the
 * transaction. This button cannot bypass that: an unpaid sale is refused with
 * a 409 no matter what the screen believes.
 *
 * The fallback member code and QR token are shown exactly once here. Only
 * their hashes are stored, so they cannot be displayed again.
 */
export function BusinessActivationQueuePage() {
  const client = useQueryClient();
  const queue = useQuery({
    queryKey: ['business', 'queue', 'activation'],
    queryFn: getActivationQueue,
    // Activations and payments land from other sessions: poll the queue
    // (same-session writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const [activating, setActivating] = useState<FinanceQueueItem | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue', 'activation'] });
    // Activation changes what member lookup, memberships and the activation
    // report show: refresh them in this session without reload.
    await client.invalidateQueries({ queryKey: ['member-lookup'] });
    await client.invalidateQueries({ queryKey: ['memberships'] });
    await client.invalidateQueries({ queryKey: ['reports'] });
  };

  return (
    <section>
      <PageHeader
        title="Activation Queue"
        description="Fully paid applications awaiting activation. Activation requires confirmed full payment and is performed by the server, not the browser."
      />

      {queue.isPending ? (
        <p role="status">Loading queue…</p>
      ) : queue.isError ? (
        <ErrorState error={queue.error} onRetry={queue.refetch} />
      ) : queue.data?.length === 0 ? (
        <EmptyState title="Nothing to activate" description="No application is fully paid yet." />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Scheme</th>
                <th>Total</th>
                <th>Verified</th>
                <th>Balance</th>
                <th>Validity</th>
                <th>First verified</th>
                <th>Spot cash</th>
                <th>Deadline</th>
                <th>Ready</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.data?.map((item) => (
                <tr key={item.saleId}>
                  <td>{item.saleNumber}</td>
                  <td>{item.customerName}</td>
                  <td>{item.productName}</td>
                  <td>{paymentSchemeLabel(item.paymentScheme)}</td>
                  <td>{formatMoney(item.cashPrice)}</td>
                  <td>{formatMoney(item.verifiedTotal)}</td>
                  <td>{formatMoney(item.remainingBalance)}</td>
                  <td>
                    {item.validityMonths
                      ? `${item.validityMonths} mo${item.validityMonths % 12 === 0 ? ` (${item.validityMonths / 12}y)` : ''}`
                      : '—'}
                  </td>
                  <td>
                    {item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}
                  </td>
                  <td>
                    <StatusChip
                      label={SPOT_CASH_LABEL[item.spotCashState] ?? item.spotCashState}
                      tone={SPOT_CASH_TONE[item.spotCashState] ?? 'neutral'}
                    />
                  </td>
                  <td>{item.spotCashDeadline ? formatDateTime(item.spotCashDeadline) : '—'}</td>
                  <td>
                    <StatusChip
                      label={item.activatable ? 'Eligible' : 'Not eligible'}
                      tone={item.activatable ? 'success' : 'warning'}
                    />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      disabled={!item.activatable}
                      onClick={() => {
                        setActivating(item);
                        setResult(null);
                      }}
                    >
                      Activate
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activating ? (
        <ActivateDialog
          item={activating}
          onClose={() => setActivating(null)}
          onDone={async (activation) => {
            setResult(activation);
            await refresh();
          }}
        />
      ) : null}
      {result ? <IdentifiersDialog result={result} onClose={() => setResult(null)} /> : null}

      <CommissionReview />
    </section>
  );
}

function ActivateDialog({
  item,
  onClose,
  onDone,
}: {
  item: FinanceQueueItem;
  onClose: () => void;
  onDone: (result: ActivationResult) => Promise<void>;
}) {
  // VIP Stage 1: new sales carry a frozen validity and the server prefers it;
  // the field is shown read-only. Pre-scheme sales (no snapshot) keep the
  // editable 12-month default.
  const frozen = item.validityMonths;
  const [months, setMonths] = useState(frozen ? String(frozen) : '12');
  const activate = useMutation({
    mutationFn: () => activateSale(item.saleId, Number(months)),
    onSuccess: onDone,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Activate membership"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={activate.isPending} onClick={() => activate.mutate()}>
            Activate
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          The server recomputes the verified total inside the transaction. If it does not reach the
          snapshotted price, the activation is refused and nothing is created.
        </p>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 8,
            margin: 0,
          }}
        >
          <div>
            <dt>Scheme</dt>
            <dd>{paymentSchemeLabel(item.paymentScheme)}</dd>
          </div>
          <div>
            <dt>Frozen total</dt>
            <dd>{formatMoney(item.cashPrice)}</dd>
          </div>
        </dl>
        {frozen ? (
          <p>
            Membership validity: <strong>{frozen} months</strong>
            {frozen % 12 === 0 ? ` (${frozen / 12} years)` : ''} — frozen from the sale.
          </p>
        ) : (
          <label>
            Validity (months)
            <input
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
            />
          </label>
        )}
        {activate.error ? <p role="alert">{activate.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

export function IdentifiersDialog({
  result,
  onClose,
}: {
  result: ActivationResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'token' | 'link' | null>(null);
  const [copyError, setCopyError] = useState(false);

  const copy = async (kind: 'token' | 'link', value: string) => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={result.alreadyActive ? 'Already activated' : 'Membership activated'}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <p>
          Membership <strong>{result.membershipNumber}</strong> is active with{' '}
          {formatPoints(result.pointsAllocated)} yearly points allocated.
        </p>
        {result.fallbackCode ? (
          <p>
            Fallback member code: <code>{result.fallbackCode}</code>
          </p>
        ) : null}
        {result.qrToken ? (
          <p>
            QR token: <code style={{ wordBreak: 'break-all' }}>{result.qrToken}</code>
          </p>
        ) : null}
        {result.alreadyActive ? (
          <p>
            This membership was already active, so no new identifiers or onboarding token were
            issued. If the customer already created a sign-in, direct them to{' '}
            <a href="/customer/forgot-password">Forgot Password</a>.
          </p>
        ) : (
          <p>
            <strong>Shown once.</strong> Only hashes of these identifiers are stored, so they cannot
            be displayed again. Hand them to the member now; a replacement can be issued if lost.
          </p>
        )}

        {!result.alreadyActive && result.onboarding.status === 'email_sent' ? (
          <p role="status">
            The customer activation email was accepted by the configured mail server. Keep the
            one-time fallback below until the customer confirms receipt.
          </p>
        ) : null}
        {!result.alreadyActive && result.onboarding.status === 'manual_required' ? (
          <p role="alert">
            <strong>Membership activation succeeded, but email delivery failed.</strong> Give the
            customer the one-time activation code or secure link below now.
          </p>
        ) : null}
        {!result.alreadyActive && result.onboarding.status === 'not_issued' ? (
          <p role="alert">
            <strong>Membership activation succeeded, but no onboarding code was issued.</strong> Do
            not activate the sale again. Contact an administrator to issue a customer onboarding
            token through the authorized customer workflow.
          </p>
        ) : null}

        {result.onboarding.token ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="customer-onboarding-token">Customer activation code</label>
            <input
              id="customer-onboarding-token"
              value={result.onboarding.token}
              readOnly
              spellCheck={false}
            />
            <Button variant="secondary" onClick={() => copy('token', result.onboarding.token!)}>
              {copied === 'token' ? 'Activation code copied' : 'Copy activation code'}
            </Button>
          </div>
        ) : null}
        {result.onboarding.activationUrl ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label htmlFor="customer-activation-link">Customer activation link</label>
            <input
              id="customer-activation-link"
              value={result.onboarding.activationUrl}
              readOnly
              spellCheck={false}
            />
            <Button
              variant="secondary"
              onClick={() => copy('link', result.onboarding.activationUrl!)}
            >
              {copied === 'link' ? 'Activation link copied' : 'Copy activation link'}
            </Button>
          </div>
        ) : null}
        {result.onboarding.expiresAt ? (
          <p>The customer activation code expires {formatDateTime(result.onboarding.expiresAt)}.</p>
        ) : null}
        {copyError ? (
          <p role="alert">Copy failed. Select the code or link manually before closing.</p>
        ) : null}
        {result.onboarding.token ? (
          <p>
            <strong>Shown once.</strong> Closing this dialog removes the plaintext onboarding code
            from this screen. It is never stored in readable form and cannot be retrieved later.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Commission qualification.
 *
 * A commission is never earned automatically. Reaching `earned` is an explicit,
 * audited decision that only applies to a commission already awaiting final
 * qualification, and it requires written notes. The rule that permits
 * qualification is a business decision that is not yet defined, which is why
 * this action is manual and gated.
 */
function CommissionReview() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['business', 'commissions'],
    queryFn: () => getCommissions(),
  });
  const [deciding, setDeciding] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'earned' | 'cancelled'>('earned');

  const decide = useMutation({
    mutationFn: () => qualifyCommission(deciding!, { decision, notes }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['business', 'commissions'] });
      setDeciding(null);
      setNotes('');
    },
  });

  const awaiting = query.data?.filter((c) => c.status === 'final_qualification_pending') ?? [];

  return (
    <div style={{ marginTop: 32 }}>
      <h2>Commissions awaiting final qualification</h2>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : awaiting.length === 0 ? (
        <p>No commission is awaiting a qualification decision.</p>
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Beneficiary</th>
                <th>Basis</th>
                <th>Rate</th>
                <th>Commission</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {awaiting.map((commission) => (
                <tr key={commission.id}>
                  <td>{commission.saleNumber}</td>
                  <td>{commission.beneficiaryName}</td>
                  <td>{formatMoney(commission.basisAmount)}</td>
                  <td>{commission.rate}</td>
                  <td>{formatMoney(commission.amount)}</td>
                  <td>
                    <StatusChip label="Awaiting qualification" tone="warning" />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setDeciding(commission.id);
                        setDecision('earned');
                      }}
                    >
                      Decide
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title="Final qualification decision"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              disabled={notes.trim().length < 5 || decide.isPending}
              onClick={() => decide.mutate()}
            >
              Record decision
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p>
            This decision is the only way a commission becomes earned. It is recorded in the audit
            trail with your notes and your identity.
          </p>
          <label>
            Decision
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value as 'earned' | 'cancelled')}
            >
              <option value="earned">Qualify — commission earned</option>
              <option value="cancelled">Cancel — commission cancelled</option>
            </select>
          </label>
          <label>
            Notes (required)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {decide.error ? <p role="alert">{decide.error.message}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}
