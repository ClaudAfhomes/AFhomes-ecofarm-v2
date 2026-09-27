import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, PageHeader, QrCode, StatusChip } from '@jad/ui';
import { buildOstRegistrationUrl } from '@jad/contracts';

import { env } from '../../lib/env';
import { formatDateTime } from '../../lib/format';
import { createReferralCode, getMyReferralCodes, getOstApplications } from './services';

/**
 * The Sales Manager self-service screen: my referral codes with their QR,
 * issuing a new code, and the applications submitted under me with their
 * statuses. Approval never happens here - it is an administrative review on
 * the applications screen.
 *
 * The QR encodes the registration URL only. It is not a credential and not a
 * membership card; the server validates the code on every submission.
 */
export function OstReferralCodesPage() {
  const client = useQueryClient();
  const codes = useQuery({ queryKey: ['ost', 'my-codes'], queryFn: getMyReferralCodes });
  const applications = useQuery({
    queryKey: ['ost', 'my-applications'],
    queryFn: () => getOstApplications(),
  });
  const [maxUses, setMaxUses] = useState(10);
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [issued, setIssued] = useState<{ code: string; hint: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = useMutation({
    mutationFn: () => createReferralCode({ maxUses, expiresInHours }),
    onSuccess: (result) => {
      // The raw code is returned exactly once. Keep it on screen until the
      // next issuance; it is never fetched again.
      setIssued({ code: result.code, hint: result.codeHint });
      setCopied(false);
      void client.invalidateQueries({ queryKey: ['ost', 'my-codes'] });
    },
  });

  const webBase =
    env.VITE_WEB_URL && env.VITE_WEB_URL.length > 0 ? env.VITE_WEB_URL : window.location.origin;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <PageHeader
        title="My Referral Code"
        description="Share your code or QR so applicants register under you. The sponsor is frozen from the code at submission."
      />

      {issued ? (
        <div
          style={{
            border: '1px solid currentColor',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            maxWidth: 560,
          }}
        >
          <h2>New code issued (shown once)</h2>
          <p>
            <strong>{issued.code}</strong> <StatusChip label={issued.hint} tone="neutral" />
          </p>
          <QrCode
            value={buildOstRegistrationUrl(issued.code, webBase)}
            alt={`OST registration QR for ${issued.code}`}
            size={160}
          />
          <p style={{ overflowWrap: 'anywhere' }}>
            {buildOstRegistrationUrl(issued.code, webBase)}
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void copy(`${issued.code}\n${buildOstRegistrationUrl(issued.code, webBase)}`)
            }
          >
            {copied ? 'Copied' : 'Copy code and link'}
          </Button>
        </div>
      ) : null}

      <div
        style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 24, flexWrap: 'wrap' }}
      >
        <label>
          Max uses
          <input
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          />
        </label>
        <label>
          Expires in (hours)
          <input
            type="number"
            min={24}
            max={720}
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
          />
        </label>
        <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
          {issue.isPending ? 'Issuing…' : 'Issue new code'}
        </Button>
      </div>
      {issue.isError ? <ErrorState error={issue.error} onRetry={() => issue.mutate()} /> : null}

      {codes.isPending ? (
        <p role="status">Loading codes…</p>
      ) : codes.isError ? (
        <ErrorState error={codes.error} onRetry={codes.refetch} />
      ) : codes.data?.length === 0 ? (
        <EmptyState title="No referral codes" description="Issue your first code above." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hint</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {codes.data?.map((code) => (
                <tr key={code.id}>
                  <td>{code.codeHint}</td>
                  <td>
                    {code.useCount}/{code.maxUses}
                  </td>
                  <td>{formatDateTime(code.expiresAt)}</td>
                  <td>
                    <StatusChip
                      label={code.isActive ? 'active' : 'inactive'}
                      tone={code.isActive ? 'success' : 'neutral'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Only hints are stored for existing codes. The full code is shown once at issuance - keep
            it somewhere safe.
          </p>
        </div>
      )}
      <h2 style={{ marginTop: 32 }}>Applications under me</h2>
      {applications.isPending ? (
        <p role="status">Loading applications…</p>
      ) : applications.isError ? (
        <ErrorState error={applications.error} onRetry={applications.refetch} />
      ) : applications.data?.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Registrations submitted with your code appear here."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {applications.data?.map((app) => (
                <tr key={app.id}>
                  <td>{app.applicantName}</td>
                  <td>{formatDateTime(app.submittedAt)}</td>
                  <td>
                    <StatusChip
                      label={app.status.replace(/_/g, ' ')}
                      tone={app.status === 'approved' ? 'success' : 'neutral'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
