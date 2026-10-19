import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportPaymentClaim, ImportClaimDecision } from '@afhomes/contracts';
import { Button, ErrorState } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { formatPaymentMethod } from './format';
import {
  getImportClaims,
  reconcileImportClaim,
  uploadImportReceipt,
  getImportReceipt,
} from './import-workflow-services';

export function ImportPaymentClaimsPanel({ reservationId }: { reservationId: string }) {
  const [offset, setOffset] = useState(0);
  const { user } = useSession();
  const canView =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'finance.payment_verification' && p.canView,
    );
  const canUpdate =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (p) => p.moduleKey === 'finance.payment_verification' && p.canUpdate,
    );
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['import-payment-claims', reservationId, offset],
    queryFn: () => getImportClaims(reservationId, offset),
    enabled: Boolean(canView),
  });
  if (!canView || (offset === 0 && !query.isPending && !query.error && !query.data?.length))
    return null;
  return (
    <section aria-label="Imported payment claims">
      <h2>Imported payment claims</h2>
      <p>
        These amounts came from the workbook. Accepting a claim records an unverified payment. Use
        the normal verification action afterward; balances use verified payments only.
      </p>
      {query.isPending ? <p>Loading claims…</p> : null}
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data?.map((claim) => (
        <ClaimReview
          key={claim.id}
          claim={claim}
          canUpdate={Boolean(canUpdate)}
          onChanged={async () => {
            await cache.invalidateQueries();
          }}
        />
      ))}
      {offset > 0 ? (
        <Button variant="secondary" onClick={() => setOffset((n) => Math.max(0, n - 100))}>
          Previous payment claims
        </Button>
      ) : null}
      {query.data?.length === 100 ? (
        <Button variant="secondary" onClick={() => setOffset((n) => n + 100)}>
          More payment claims
        </Button>
      ) : null}
    </section>
  );
}
function ClaimReview({
  claim,
  canUpdate,
  onChanged,
}: {
  claim: ImportPaymentClaim;
  canUpdate: boolean;
  onChanged: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [match, setMatch] = useState('');
  const [receipt, setReceipt] = useState<{ url: string } | null>(null);
  const review = useMutation({
    mutationFn: async (decision: ImportClaimDecision) => {
      await reconcileImportClaim(claim, decision, crypto.randomUUID());
      await onChanged();
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      await uploadImportReceipt(claim.id, file);
      setReceipt(null);
      await onChanged();
    },
  });
  const view = useMutation({
    mutationFn: async () => setReceipt(await getImportReceipt(claim.id)),
  });
  const pending = review.isPending || upload.isPending;
  const open = ['claim', 'held'].includes(claim.status);
  return (
    <article>
      <h3>
        {claim.paymentKey} · {claim.amount} · {claim.status}
      </h3>
      <p>
        {claim.date} · {formatPaymentMethod(claim.method)} · {claim.reference || 'No receipt reference supplied'}
      </p>
      {claim.notes ? <p>{claim.notes}</p> : null}
      {claim.proofUploaded ? (
        <Button variant="secondary" onClick={() => view.mutate()} disabled={view.isPending}>
          Review receipt
        </Button>
      ) : null}
      {receipt ? (
        <a href={receipt.url} target="_blank" rel="noopener noreferrer">
          Open private receipt
        </a>
      ) : null}
      {canUpdate && open ? (
        <>
          <label>
            Receipt (JPEG, PNG or PDF, maximum 10 MiB)
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
              }}
            />
          </label>
          <label>
            Review reason
            <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          {claim.duplicateCandidates.length ? (
            <label>
              Possible existing payment
              <select value={match} onChange={(e) => setMatch(e.target.value)}>
                <option value="">Choose an existing payment</option>
                {claim.duplicateCandidates.map((p) => (
                  <option key={p.paymentId} value={p.paymentId}>
                    {p.reference || p.paymentId} · {p.amount}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            disabled={
              pending ||
              !claim.proofUploaded ||
              !claim.proofDocumentId ||
              (claim.duplicateCandidates.length > 0 && reason.trim().length < 5)
            }
            onClick={() =>
              review.mutate({
                kind: 'record',
                proofDocumentId: claim.proofDocumentId!,
                ...(claim.duplicateCandidates.length ? { distinctPaymentReason: reason } : {}),
              })
            }
          >
            Accept as unverified payment
          </Button>
          {match ? (
            <Button
              variant="secondary"
              disabled={pending || reason.trim().length < 5}
              onClick={() => review.mutate({ kind: 'match', paymentId: match, reason })}
            >
              Link existing payment
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={pending || reason.trim().length < 5}
            onClick={() => review.mutate({ kind: 'hold', reason })}
          >
            Hold claim
          </Button>
          <Button
            variant="secondary"
            disabled={pending || reason.trim().length < 5}
            onClick={() => review.mutate({ kind: 'reject', reason })}
          >
            Reject claim
          </Button>
        </>
      ) : null}
      {review.error || upload.error || view.error ? (
        <p role="alert">{(review.error ?? upload.error ?? view.error)?.message}</p>
      ) : null}
    </article>
  );
}
