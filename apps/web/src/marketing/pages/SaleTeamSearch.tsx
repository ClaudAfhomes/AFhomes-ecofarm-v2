import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aaNumberSchema, saleTeamSearchResultSchema } from '@afhomes/contracts';
import { AccreditationId, Alert, Button, Skeleton, TextField } from '@afhomes/ui';
import { request } from '../../lib/api/client';
import { Container } from '../components/ui/Container';
import { PageHeader } from '../components/ui/PageHeader';
import { Seo } from '../lib/seo';
import { cn } from '../lib/cn';

const STATUS_PILL: Record<string, { className: string }> = {
  accredited: { className: 'bg-leaf-100 text-leaf-700 ring-leaf-300' },
  expired: { className: 'bg-coral-100 text-coral-700 ring-coral-300' },
  revoked: { className: 'bg-coral-100 text-coral-700 ring-coral-300' },
  inactive: { className: 'bg-cream-200 text-ink-600 ring-line' },
  not_started: { className: 'bg-cream-200 text-ink-600 ring-line' },
};

export default function SaleTeamSearch() {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [invalid, setInvalid] = useState(false);
  const result = useQuery({
    queryKey: ['sale-team-search', submitted],
    queryFn: ({ signal }) =>
      request(
        `/sale-team/search?aaNumber=${encodeURIComponent(submitted)}`,
        saleTeamSearchResultSchema,
        { signal },
      ),
    enabled: Boolean(submitted),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const showing = submitted && submitted === input.trim().toUpperCase();
  const data = showing && !result.isFetching && result.isSuccess ? result.data : null;

  return (
    <>
      <Seo title="Verify a sales team member" description="Verify current IST and OST accreditation using an AA number." path="/sale-team-search" />
      <PageHeader eyebrow="Sales accreditation" title="Verify a sales team member" lede="Enter an AA number to confirm a seller's current accreditation." />
      <Container size="narrow" className="py-12 sm:py-16">
        <section aria-labelledby="sale-team-search-heading" className="rounded-[var(--radius-panel)] border border-line bg-cream-50 p-6 shadow-soft sm:p-8">
          <div className="max-w-2xl">
            <p className="label-caps text-leaf-700">Accreditation check</p>
            <h2 id="sale-team-search-heading" className="mt-3 font-display text-2xl font-medium text-navy-900 sm:text-3xl">Search by AA number</h2>
            <p className="mt-2 text-body-sm text-ink-600">AA numbers are printed on a seller's accreditation card. Enter the full number exactly as shown.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); const parsed = aaNumberSchema.safeParse(input); setInvalid(!parsed.success); if (parsed.success) { if (parsed.data === submitted) void result.refetch(); else setSubmitted(parsed.data); } }} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <TextField id="sale-team-aa" name="aaNumber" label="AA number" placeholder="AAI26100001 or AAO26100001" value={input} onChange={(value) => { setInput(value); setInvalid(false); }} error={invalid ? 'Enter a valid AA number.' : undefined} autoComplete="off" />
            </div>
            <Button type="submit" loading={result.isFetching} loadingLabel="Searching" className="sm:mb-[2px]">Search</Button>
          </form>
        </section>

        <div aria-live="polite" className="mt-8">
          {showing && result.isFetching ? (
            <div role="status" aria-label="Searching accreditation" className="rounded-[var(--radius-panel)] border border-line bg-cream-50 p-8 shadow-soft">
              <Skeleton style={{ height: 160 }} />
            </div>
          ) : null}

          {showing && !result.isFetching && result.isError ? (
            <Alert variant="danger">Verification is unavailable. Please retry using Search.</Alert>
          ) : null}

          {data ? (
            data.status === 'superseded' ? (
              <article aria-label="Superseded AA number" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-cream-50 shadow-soft">
                <div className="h-1.5 bg-coral-500" aria-hidden="true" />
                <div className="p-6 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full bg-coral-100 px-3 py-1 text-xs font-semibold text-coral-700 ring-1 ring-coral-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-coral-600" aria-hidden="true" />
                      No longer current
                    </span>
                    <span className="label-caps text-ink-400">Superseded record</span>
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-coral-100 text-xl font-semibold text-coral-700 ring-2 ring-coral-300">{data.photoUrl ? <img src={data.photoUrl} alt={data.fullName} className="h-full w-full rounded-full object-cover" /> : (data.fullName.trim().charAt(0) || '?').toUpperCase()}</span>
                    <div>
                      <h2 className="font-display text-2xl font-medium text-navy-900 sm:text-3xl">{data.fullName}</h2>
                      <p className="mt-1 text-body-sm text-ink-600">This AA number is no longer in force. The seller was transferred to a new accreditation.</p>
                    </div>
                  </div>

                  <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">AA number</dt>
                      <dd className="mt-2"><AccreditationId value={data.aaNumber} /></dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Sales team</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind}</dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Valid from</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind === 'IST' ? 'Not applicable — employee' : data.startsOn}</dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Valid until</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind === 'IST' ? 'No accreditation expiry' : data.expiresOn}</dd>
                    </div>
                    {data.successorAaNumber ? (
                      <div className="rounded-xl border border-leaf-300 bg-leaf-100/40 p-4 sm:col-span-2">
                        <dt className="label-caps text-leaf-700">Current AA number</dt>
                        <dd className="mt-2"><AccreditationId value={data.successorAaNumber} /></dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </article>
            ) : (
              <article aria-label="Accredited sales team member" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-cream-50 shadow-soft">
                <div className="h-1.5 bg-leaf-500" aria-hidden="true" />
                <div className="p-6 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1', (STATUS_PILL[data.status] ?? STATUS_PILL.accredited)?.className ?? '')}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      {data.kind === 'IST' ? 'Employee identity' : 'Currently accredited'}
                    </span>
                    <span className="label-caps text-ink-400">Verified record</span>
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-xl font-semibold text-leaf-700 ring-2 ring-leaf-300">{data.photoUrl ? <img src={data.photoUrl} alt={data.fullName} className="h-full w-full rounded-full object-cover" /> : (data.fullName.trim().charAt(0) || '?').toUpperCase()}</span>
                    <h2 className="font-display text-2xl font-medium text-navy-900 sm:text-3xl">{data.fullName}</h2>
                  </div>

                  <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Sales team</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind}</dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">AA number</dt>
                      <dd className="mt-2"><AccreditationId value={data.aaNumber} /></dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Status</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind === 'IST' ? 'Employee identity' : 'Currently accredited'}</dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4">
                      <dt className="label-caps text-ink-400">Valid from</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind === 'IST' ? 'Not applicable — employee' : data.startsOn}</dd>
                    </div>
                    <div className="rounded-xl border border-line bg-cream-100/60 p-4 sm:col-span-2">
                      <dt className="label-caps text-ink-400">Valid until</dt>
                      <dd className="mt-2 font-medium text-ink-800">{data.kind === 'IST' ? 'No accreditation expiry' : data.expiresOn}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            )
          ) : null}

          {showing && !result.isFetching && result.isSuccess && !result.data ? (
            <div role="status" className="rounded-[var(--radius-panel)] border border-dashed border-line bg-cream-100/60 p-8 text-center">
              <p className="font-display text-xl font-medium text-navy-900">No current accredited seller found.</p>
              <p className="mt-2 text-body-sm text-ink-600">Check the AA number and try again. Revoked or expired records are not shown.</p>
            </div>
          ) : null}
        </div>
      </Container>
    </>
  );
}
