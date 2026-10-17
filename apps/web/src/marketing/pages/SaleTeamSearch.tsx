import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aaNumberSchema, saleTeamSearchResultSchema } from '@afhomes/contracts';
import { AccreditationId, Alert, Button, Skeleton, TextField } from '@afhomes/ui';
import { request } from '../../lib/api/client';
import { Container } from '../components/ui/Container';
import { PageHeader } from '../components/ui/PageHeader';
import { Seo } from '../lib/seo';

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
        {
          signal,
        },
      ),
    enabled: Boolean(submitted),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Clear the old verification while editing a different identifier.
  const showing = submitted && submitted === input.trim().toUpperCase();
  return (
    <>
      <Seo
        title="Verify a sales team member"
        description="Verify current IST and OST accreditation using an AA number."
        path="/sale-team-search"
      />
      <PageHeader
        eyebrow="Sales accreditation"
        title="Verify a sales team member"
        lede="Enter their AA number to verify."
      />
      <Container size="tight" className="py-12">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = aaNumberSchema.safeParse(input);
            setInvalid(!parsed.success);
            if (parsed.success) {
              if (parsed.data === submitted) void result.refetch();
              else setSubmitted(parsed.data);
            }
          }}
        >
          <TextField
            id="sale-team-aa"
            name="aaNumber"
            label="AA number"
            placeholder="AAI26100001 or AAO26100001"
            value={input}
            onChange={(value) => {
              setInput(value);
              setInvalid(false);
            }}
            error={invalid ? 'Enter a valid AA number.' : undefined}
            autoComplete="off"
          />
          <Button type="submit" loading={result.isFetching} loadingLabel="Searching">
            Search
          </Button>
        </form>
        <div aria-live="polite" className="mt-6">
          {showing && result.isFetching ? (
            <div role="status" aria-label="Searching accreditation">
              <Skeleton style={{ height: 120 }} />
            </div>
          ) : null}
          {showing && !result.isFetching && result.isError ? (
            <Alert variant="danger">Verification is unavailable. Please retry using Search.</Alert>
          ) : null}
          {showing && !result.isFetching && result.isSuccess ? (
            result.data ? (
              <section
                aria-label={
                  result.data.status === 'superseded'
                    ? 'Superseded AA number'
                    : 'Accredited sales team member'
                }
                className="rounded-xl border border-leaf-300 p-6"
              >
                <h2 className="text-xl font-semibold">{result.data.fullName}</h2>
                <dl className="mt-4 space-y-2">
                  <div>
                    <dt>Sales team</dt>
                    <dd>{result.data.kind}</dd>
                  </div>
                  <div>
                    <dt>AA number</dt>
                    <dd>
                      <AccreditationId value={result.data.aaNumber} />
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      {result.data.status === 'superseded'
                        ? 'No longer current'
                        : 'Currently accredited'}
                    </dd>
                  </div>
                  {result.data.status === 'superseded' && result.data.successorAaNumber ? (
                    <div>
                      <dt>Current AA number</dt>
                      <dd>
                        <AccreditationId value={result.data.successorAaNumber} />
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Valid from</dt>
                    <dd>{result.data.startsOn}</dd>
                  </div>
                  <div>
                    <dt>Valid until</dt>
                    <dd>{result.data.expiresOn}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <p role="status">No current accredited seller found.</p>
            )
          ) : null}
        </div>
      </Container>
    </>
  );
}
