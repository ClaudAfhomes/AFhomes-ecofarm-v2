import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import {
  ostAccreditationRecordsSchema,
  ostMutationResultSchema,
  submitOstRenewalSchema,
} from '@jad/contracts';
import { Button, ErrorState, PageHeader } from '@jad/ui';
import { useCustomerSession } from '../../lib/customer-session';
import { request, requestList } from '../../lib/api/client';
import { getOstMe } from './services';

/** Ownership-scoped renewal. Identity and prior history are resolved server-side. */
export function OstRenewalPage() {
  const { user } = useCustomerSession();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['ost', 'me'], queryFn: getOstMe });
  const records = useQuery({
    queryKey: ['ost', 'accreditation', user?.authUserId],
    enabled: Boolean(user),
    queryFn: () =>
      request(`/ost-accreditation/members/${user?.authUserId}`, ostAccreditationRecordsSchema),
  });
  const sponsors = useQuery({
    queryKey: ['ost', 'sponsors'],
    queryFn: () =>
      requestList(
        '/ost-accreditation/sponsors',
        z.object({ id: z.string().uuid(), name: z.string() }),
      ),
  });
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState({
    dateOfRenewal: new Date().toISOString().slice(0, 10),
    requestedStart: '',
    requestedEnd: '',
    proposedNewSponsorStaffId: '',
    reasonForReferrerChange: '',
    applicantSignatureStatus: 'pending',
    referrerSignatureStatus: 'pending',
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = submitOstRenewalSchema.safeParse({
        ...fields,
        requestId,
        proposedNewSponsorStaffId: fields.proposedNewSponsorStaffId || null,
      });
      if (!body.success)
        throw new Error(body.error.issues[0]?.message ?? 'Check the renewal details.');
      return request(
        editing
          ? `/ost-accreditation/renewals/${editing}/revise`
          : `/ost-accreditation/members/${user?.authUserId}/renew`,
        ostMutationResultSchema,
        { method: 'POST', body: JSON.stringify(body.data) },
      );
    },
    onSuccess: () => {
      setEditing(null);
      setRequestId(crypto.randomUUID());
      void client.invalidateQueries({ queryKey: ['ost', 'accreditation'] });
    },
  });
  if (records.isPending || me.isPending) return <p role="status">Loading your accreditation…</p>;
  if (records.isError || me.isError)
    return (
      <ErrorState
        error={records.error ?? me.error}
        onRetry={() => {
          void records.refetch();
          void me.refetch();
        }}
      />
    );
  return (
    <section>
      <PageHeader
        title="Accreditation renewal"
        description={`${me.data.fullName} · ${me.data.ostNumber} · Current sponsor: ${me.data.sponsorName}`}
      />
      <Link to="/ost/dashboard">Back to your account</Link>
      <h2>Approved validity history</h2>
      <ul>
        {records.data.terms.map((t) => (
          <li key={t.id}>
            {t.starts_on} to {t.expires_on} · {t.displayStatus}
          </li>
        ))}
      </ul>
      {!records.data.terms.length ? (
        <p>
          No recorded accreditation term. Contact management; historical dates cannot be inferred.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <p>
            Original accreditation: {records.data.terms[0]?.starts_on}. Last expiry:{' '}
            {records.data.terms.at(-1)?.expires_on}. Your approved identity and program details
            carry forward.
          </p>
          {(['dateOfRenewal', 'requestedStart', 'requestedEnd'] as const).map((name) => (
            <label key={name}>
              {name.replace(/([A-Z])/g, ' $1')}
              <input
                type="date"
                required
                value={fields[name]}
                onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
              />
            </label>
          ))}
          <label>
            Referrer change
            <select
              value={fields.proposedNewSponsorStaffId}
              onChange={(e) =>
                setFields((f) => ({ ...f, proposedNewSponsorStaffId: e.target.value }))
              }
            >
              <option value="">None — retain current referrer</option>
              {sponsors.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason for proposed change
            <textarea
              value={fields.reasonForReferrerChange}
              onChange={(e) =>
                setFields((f) => ({ ...f, reasonForReferrerChange: e.target.value }))
              }
            />
          </label>
          <p>
            Signature status refers to the signed official renewal form. Submission does not change
            your sponsor or validity.
          </p>
          {(['applicantSignatureStatus', 'referrerSignatureStatus'] as const).map((name) => (
            <label key={name}>
              {name.replace(/([A-Z])/g, ' $1')}
              <select
                value={fields[name]}
                onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
              >
                <option value="pending">Pending</option>
                <option value="received">Received</option>
              </select>
            </label>
          ))}
          <Button type="submit" disabled={save.isPending}>
            {editing ? 'Submit revised renewal' : 'Submit renewal for review'}
          </Button>
        </form>
      )}
      <h2>Renewal history</h2>
      {records.data.renewals.map((r) => (
        <article key={r.id}>
          <h3>{r.renewal_number}</h3>
          <p>
            {r.requested_start} to {r.requested_end} · {r.status.replace(/_/g, ' ')}
          </p>
          {r.review_notes && <p>{r.review_notes}</p>}
          {['submitted', 'under_review', 'changes_requested'].includes(r.status) && (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(r.id);
                setFields({
                  dateOfRenewal: r.date_of_renewal,
                  requestedStart: r.requested_start,
                  requestedEnd: r.requested_end,
                  proposedNewSponsorStaffId: r.proposed_new_sponsor_staff_id ?? '',
                  reasonForReferrerChange: r.reason_for_referrer_change ?? '',
                  applicantSignatureStatus: r.applicant_signature_status,
                  referrerSignatureStatus: r.referrer_signature_status,
                });
              }}
            >
              Revise pending renewal
            </Button>
          )}
        </article>
      ))}
      {sponsors.isError && <ErrorState error={sponsors.error} onRetry={sponsors.refetch} />}
      {save.isError && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && (
        <p role="status">
          Renewal saved for review. Your approved sponsor and validity remain unchanged.
        </p>
      )}
    </section>
  );
}
