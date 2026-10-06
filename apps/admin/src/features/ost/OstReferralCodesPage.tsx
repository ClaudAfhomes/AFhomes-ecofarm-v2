import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  QrCode,
  SearchField,
  StatusChip,
} from '@afhomes/ui';
import { buildOstRegistrationUrl } from '@afhomes/contracts';

import { env } from '../../lib/env';
import { formatDateTime } from '../../lib/format';
import {
  createReferralCode,
  getMyReferralCodes,
  getOstApplications,
  getOstSponsors,
} from './services';
import { useSession } from '../../lib/session';

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
  const { user } = useSession();
  const onBehalf = ['admin', 'super_admin'].includes(user?.roleSlug ?? '');
  const [sponsorStaffId, setSponsorStaffId] = useState('');
  const sponsors = useQuery({
    queryKey: ['ost', 'sponsors'],
    queryFn: getOstSponsors,
    enabled: onBehalf,
  });
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());
  const codes = useQuery({ queryKey: ['ost', 'my-codes', onBehalf ? sponsorStaffId : 'self'], queryFn: () => getMyReferralCodes(onBehalf ? sponsorStaffId : undefined), enabled: !onBehalf || Boolean(sponsorStaffId) });
  const applications = useQuery({
    queryKey: ['ost', 'my-applications', settled],
    queryFn: () => (settled ? getOstApplications('', settled) : getOstApplications()),
  });
  const visibleCodes = codes.data?.filter(
    (code) =>
      !settled ||
      [code.codeHint, code.isActive ? 'active' : 'inactive'].some((value) =>
        value.toLowerCase().includes(settled.toLowerCase()),
      ),
  );
  const [maxUses, setMaxUses] = useState(10);
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [issued, setIssued] = useState<{ code: string; hint: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const hasActiveCode = Boolean(codes.data?.some(c => c.isActive && Date.parse(c.expiresAt) > openedAt && c.useCount < c.maxUses));

  const issue = useMutation({
    mutationFn: () => {
      if (onBehalf && !sponsorStaffId)
        throw new Error('Choose an active Sales Manager to issue on their behalf.');
      return createReferralCode({
        maxUses,
        expiresInHours,
        rotate: hasActiveCode,
        ...(onBehalf ? { sponsorStaffId } : {}),
      });
    },
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
        {onBehalf && (
          <label>
            Issue on behalf of Sales Manager
            <select value={sponsorStaffId} onChange={(e) => { setSponsorStaffId(e.target.value); setIssued(null); }}>
              <option value="">Choose an active Sales Manager</option>
              {sponsors.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <Button onClick={() => issue.mutate()} disabled={issue.isPending || codes.isFetching || codes.isError || (onBehalf && !sponsorStaffId)}>
          {issue.isPending ? 'Issuing...' : hasActiveCode ? 'Rotate and revoke previous codes' : 'Issue new code'}
        </Button>
      </div>
      {issue.isError ? <ErrorState error={issue.error} onRetry={() => issue.mutate()} /> : null}

      <p>For security, the full code is shown only when issued. Active referral codes cannot be displayed again.</p>
      <SearchField label="Search referral codes" value={search} onChange={setSearch} />
      {codes.isPending ? (
        <p role="status">Loading codes…</p>
      ) : codes.isError ? (
        <ErrorState error={codes.error} onRetry={codes.refetch} />
      ) : visibleCodes?.length === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'No referral codes'}
          description="Issue your first code above."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
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
              {visibleCodes?.map((code) => (
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
          title={settled ? 'No matching records.' : 'No applications yet'}
          description="Registrations submitted with your code appear here."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
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
