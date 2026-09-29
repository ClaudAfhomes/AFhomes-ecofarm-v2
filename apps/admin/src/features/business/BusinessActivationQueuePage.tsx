import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';
import type { ActivationResult } from '@jad/contracts';

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
  const queue = useQuery({ queryKey: ['business', 'queue', 'activation'], queryFn: getActivationQueue });
  const [activating, setActivating] = useState<string | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue', 'activation'] });
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
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sale</th>
                <th>Customer</th>
                <th>Card</th>
                <th>Total</th>
                <th>Verified</th>
                <th>Balance</th>
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
                  <td>{formatMoney(item.cashPrice)}</td>
                  <td>{formatMoney(item.verifiedTotal)}</td>
                  <td>{formatMoney(item.remainingBalance)}</td>
                  <td>{item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}</td>
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
                      disabled={!item.activatable}
                      onClick={() => {
                        setActivating(item.saleId);
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
          saleId={activating}
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
  saleId,
  onClose,
  onDone,
}: {
  saleId: string;
  onClose: () => void;
  onDone: (result: ActivationResult) => Promise<void>;
}) {
  const [months, setMonths] = useState('12');
  const activate = useMutation({
    mutationFn: () => activateSale(saleId, Number(months)),
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
        <label>
          Validity (months)
          <input
            value={months}
            onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </label>
        {activate.error ? <p role="alert">{activate.error.message}</p> : null}
      </div>
    </Dialog>
  );
}

function IdentifiersDialog({
  result,
  onClose,
}: {
  result: ActivationResult;
  onClose: () => void;
}) {
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
          <p>This membership was already active, so no new identifiers were issued.</p>
        ) : (
          <p>
            <strong>Shown once.</strong> Only hashes of these identifiers are stored, so they cannot be
            displayed again. Hand them to the member now; a replacement can be issued if lost.
          </p>
        )}
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
  const query = useQuery({ queryKey: ['business', 'commissions'], queryFn: () => getCommissions() });
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
        <div className="table-scroll">
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
            <Button disabled={notes.trim().length < 5 || decide.isPending} onClick={() => decide.mutate()}>
              Record decision
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p>
            This decision is the only way a commission becomes earned. It is recorded in the audit trail
            with your notes and your identity.
          </p>
          <label>
            Decision
            <select value={decision} onChange={(e) => setDecision(e.target.value as 'earned' | 'cancelled')}>
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
