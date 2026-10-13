import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
  Pagination,
  QrCode,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import { buildOstRegistrationUrl } from '@afhomes/contracts';
import { formatCountOrDash } from '@afhomes/shared';

import { env } from '../../lib/env';
import { formatDateTime } from '../../lib/format';
import {
  createReferralCode,
  getMyReferralCodes,
  getOstApplications,
  getOstSponsors,
} from './services';
import { useSession } from '../../lib/session';
import styles from './OstReferralCodesPage.module.css';

/** Query keys scoped to the referral-code workspace. */
const ostReferralKeys = {
  sponsors: ['ost', 'sponsors'] as const,
  codes: (owner: string) => ['ost', 'my-codes', owner] as const,
  applications: (search: string) => ['ost', 'my-applications', search] as const,
};

const CODE_PAGE_SIZE = 10;
const APPLICATION_PAGE_SIZE = 10;

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
    queryKey: ostReferralKeys.sponsors,
    queryFn: getOstSponsors,
    enabled: onBehalf,
    placeholderData: keepPreviousData,
  });
  const [search, setSearch] = useState('');
  const [codePage, setCodePage] = useState(0);
  const [applicationPage, setApplicationPage] = useState(0);
  const settled = useDebouncedValue(search.trim(), 300, () => {
    setCodePage(0);
    setApplicationPage(0);
  });
  const codes = useQuery({
    queryKey: ostReferralKeys.codes(onBehalf ? sponsorStaffId : 'self'),
    queryFn: () => getMyReferralCodes(onBehalf ? sponsorStaffId : undefined),
    enabled: !onBehalf || Boolean(sponsorStaffId),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const applications = useQuery({
    queryKey: ostReferralKeys.applications(settled),
    queryFn: () => (settled ? getOstApplications('', settled) : getOstApplications()),
    placeholderData: keepPreviousData,
  });
  const visibleCodes = codes.data?.filter(
    (code) =>
      !settled ||
      [code.codeHint, code.isActive ? 'active' : 'inactive'].some((value) =>
        value.toLowerCase().includes(settled.toLowerCase()),
      ),
  );
  const codeTotal = visibleCodes?.length ?? 0;
  const codePageCount = Math.max(1, Math.ceil(codeTotal / CODE_PAGE_SIZE));
  const safeCodePage = Math.min(codePage, codePageCount - 1);
  const codeRows = (visibleCodes ?? []).slice(
    safeCodePage * CODE_PAGE_SIZE,
    (safeCodePage + 1) * CODE_PAGE_SIZE,
  );
  const applicationRows = applications.data ?? [];
  const applicationTotal = applicationRows.length;
  const applicationPageCount = Math.max(1, Math.ceil(applicationTotal / APPLICATION_PAGE_SIZE));
  const safeApplicationPage = Math.min(applicationPage, applicationPageCount - 1);
  const applicationVisible = applicationRows.slice(
    safeApplicationPage * APPLICATION_PAGE_SIZE,
    (safeApplicationPage + 1) * APPLICATION_PAGE_SIZE,
  );
  const [maxUses, setMaxUses] = useState(10);
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [issued, setIssued] = useState<{ code: string; hint: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const hasActiveCode = Boolean(
    codes.data?.some((c) => c.isActive && Date.parse(c.expiresAt) > now && c.useCount < c.maxUses),
  );
  const activeCodes = codes.data?.filter(
    (c) => c.isActive && Date.parse(c.expiresAt) > now && c.useCount < c.maxUses,
  ).length;
  const totalUses = codes.data?.reduce((sum, c) => sum + c.useCount, 0);

  const issue = useBusinessMutation({
    onMutate: () => {
      setIssued(null);
      setCopied(false);
    },
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

  // First load skeletonizes the workspace while the code list resolves.
  // Refetches keep the previous codes visible and never reach this branch.
  if (codes.isPending && (!onBehalf || sponsorStaffId)) {
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading referral codes"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 260 }} />
            <Skeleton style={{ height: 16, maxWidth: 460 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, width: 220 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
          </div>
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
          <span className="sr-only">Loading codes…</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <PageHeader
        title="My Referral Code"
        description="Share your code or QR so applicants register under you. The sponsor is frozen from the code at submission."
      />

      {issued ? (
        <div className={styles.issuedPanel}>
          <h2>New code issued (shown once)</h2>
          <p>Save this code now. It cannot be viewed again.</p>
          <p>
            <strong>{issued.code}</strong> <StatusChip label={issued.hint} tone="neutral" />
          </p>
          <QrCode
            value={buildOstRegistrationUrl(issued.code, webBase)}
            alt={`OST registration QR for ${issued.code}`}
            size={160}
          />
          <p className={styles.wrapAnywhere}>{buildOstRegistrationUrl(issued.code, webBase)}</p>
          <Button
            variant="secondary"
            onClick={() =>
              void copy(`${issued.code}\n${buildOstRegistrationUrl(issued.code, webBase)}`)
            }
          >
            {copied ? 'Copied' : 'Copy code and link'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setIssued(null);
              issue.reset();
            }}
          >
            Dismiss code
          </Button>
        </div>
      ) : null}

      <div className={styles.metrics} aria-label="Referral summary">
        <MetricCard
          label="Active codes"
          value={formatCountOrDash(activeCodes ?? 0)}
          description="Usable codes that have not expired."
          icon="grid"
          chip={{ label: 'Active', tone: 'success' }}
        />
        <MetricCard
          label="Recorded uses"
          value={formatCountOrDash(totalUses ?? 0)}
          description="Registrations submitted with your codes."
          icon="check"
        />
        <MetricCard
          label="Sponsored applications"
          value={formatCountOrDash(applicationTotal)}
          description="Registrations submitted with your code."
          icon="clock"
        />
      </div>

      <div className={styles.filtersRow}>
        {onBehalf && (
          <label className={styles.filterLabel}>
            Issue on behalf of Sales Manager
            <Select
              value={sponsorStaffId}
              disabled={issue.isPending}
              onChange={(e) => {
                setSponsorStaffId(e.target.value);
                setIssued(null);
                issue.reset();
              }}
              options={[
                { value: '', label: 'Choose an active Sales Manager' },
                ...(sponsors.data?.map((s) => ({ value: s.id, label: s.name })) ?? []),
              ]}
            />
          </label>
        )}
        <label className={styles.filterLabel}>
          Max uses
          <input
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          />
        </label>
        <label className={styles.filterLabel}>
          Expires in (hours)
          <input
            type="number"
            min={24}
            max={720}
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
          />
        </label>
        <Button
          onClick={() => issue.mutate()}
          disabled={
            issue.isPending || codes.isFetching || codes.isError || (onBehalf && !sponsorStaffId)
          }
        >
          {issue.isPending
            ? 'Issuing...'
            : hasActiveCode
              ? 'Rotate and revoke previous codes'
              : 'Issue new code'}
        </Button>
      </div>
      {issue.isError ? (
        <ErrorState
          error={issue.error}
          title="Referral code could not be issued"
          onRetry={() => {
            issue.reset();
            void codes.refetch();
          }}
        />
      ) : null}

      <p>
        For security, the full code is shown only when issued. Active referral codes cannot be
        displayed again.
      </p>
      <FilterBar
        search={
          <SearchField
            label="Search referral codes"
            placeholder="Code hint or status"
            value={search}
            onChange={setSearch}
            busy={codes.isFetching || applications.isFetching}
          />
        }
      />
      {onBehalf && !sponsorStaffId ? (
        <EmptyState title="Choose an active Sales Manager to view their referral credentials" />
      ) : codes.isPending ? (
        <div role="status" aria-label="Loading referral codes">
          <Skeleton style={{ height: 48 }} />
          <Skeleton style={{ height: 48 }} />
          <span className="sr-only">Loading codes…</span>
        </div>
      ) : codes.isError ? (
        <ErrorState
          error={codes.error}
          title="Referral codes could not be loaded"
          onRetry={() => void codes.refetch()}
        />
      ) : codeTotal === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'No referral codes'}
          description="Issue your first code above."
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Hint</TableHeaderCell>
                  <TableHeaderCell>Uses</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {codeRows.map((code) => (
                  <TableRow key={code.id}>
                    <TableCell label="Hint">{code.codeHint}</TableCell>
                    <TableCell label="Uses">
                      {code.useCount}/{code.maxUses}
                    </TableCell>
                    <TableCell label="Expires">{formatDateTime(code.expiresAt)}</TableCell>
                    <TableCell label="Created">{formatDateTime(code.createdAt)}</TableCell>
                    <TableCell label="Active">
                      <StatusChip
                        label={
                          !code.isActive
                            ? 'revoked'
                            : Date.parse(code.expiresAt) <= now
                              ? 'expired'
                              : code.useCount >= code.maxUses
                                ? 'exhausted'
                                : 'active'
                        }
                        tone={
                          code.isActive &&
                          Date.parse(code.expiresAt) > now &&
                          code.useCount < code.maxUses
                            ? 'success'
                            : 'neutral'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p>
              Only hints are stored for existing codes. The full code is shown once at issuance -
              keep it somewhere safe.
            </p>
          </div>
          {codeTotal > CODE_PAGE_SIZE ? (
            <div className={styles.pagination}>
              <Pagination
                page={safeCodePage + 1}
                pageCount={codePageCount}
                onChange={(next) => setCodePage(next - 1)}
                label="Referral codes pagination"
              />
            </div>
          ) : null}
        </>
      )}
      <h2 className={styles.sectionTitle}>Applications under me</h2>
      {applications.isPending ? (
        <div role="status" aria-label="Loading sponsored applications">
          <Skeleton style={{ height: 48 }} />
          <span className="sr-only">Loading applications…</span>
        </div>
      ) : applications.isError ? (
        <ErrorState
          error={applications.error}
          title="Sponsored applications could not be loaded"
          onRetry={() => void applications.refetch()}
        />
      ) : applicationTotal === 0 ? (
        <EmptyState
          title={settled ? 'No matching records.' : 'No applications yet'}
          description="Registrations submitted with your code appear here."
        />
      ) : (
        <>
          <div
            role="region"
            aria-label="Scrollable records"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Applicant</TableHeaderCell>
                  <TableHeaderCell>Submitted</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {applicationVisible.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell label="Applicant">{app.applicantName}</TableCell>
                    <TableCell label="Submitted">{formatDateTime(app.submittedAt)}</TableCell>
                    <TableCell label="Status">
                      <StatusChip
                        label={app.status.replace(/_/g, ' ')}
                        tone={app.status === 'approved' ? 'success' : 'neutral'}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {applicationTotal > APPLICATION_PAGE_SIZE ? (
            <div className={styles.pagination}>
              <Pagination
                page={safeApplicationPage + 1}
                pageCount={applicationPageCount}
                onChange={(next) => setApplicationPage(next - 1)}
                label="Sponsored applications pagination"
              />
            </div>
          ) : null}
        </>
      )}
      {codes.isFetching && !codes.isPending ? (
        <Alert variant="info" title="Refreshing">
          Updating referral codes with the latest issuance state.
        </Alert>
      ) : null}
    </section>
  );
}
