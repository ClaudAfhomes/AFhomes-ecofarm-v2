import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  aaNumberSchema,
  saleTeamSearchConfigSchema,
  saleTeamSearchContactSchema,
  saleTeamSearchRevealedSchema,
  saleTeamSearchStartedSchema,
  type PublicSaleTeamSearchResult,
  type SaleTeamSearchContact,
} from '@afhomes/contracts';
import { AccreditationId, Alert, Button, Dialog, TextField, TurnstileChallenge } from '@afhomes/ui';
import { request } from '../../lib/api/client';
import { ApiError } from '../../lib/api/errors';
import { Container } from '../components/ui/Container';
import { PageHeader } from '../components/ui/PageHeader';
import { Seo } from '../lib/seo';

const SESSION_KEY = 'afhomes.saleTeamSearch.session';
type SearchSession = { sessionId: string; receipt?: string; expiresAt?: number };
function loadSession(): SearchSession {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as SearchSession | null;
    if (saved && /^[\da-f-]{36}$/i.test(saved.sessionId))
      return {
        sessionId: saved.sessionId,
        ...(typeof saved.receipt === 'string' && Number(saved.expiresAt) > Date.now()
          ? { receipt: saved.receipt, expiresAt: saved.expiresAt }
          : {}),
      };
  } catch {
    /* Storage may be unavailable; the in-memory session still works. */
  }
  return { sessionId: crypto.randomUUID() };
}

export default function SaleTeamSearch() {
  const configQuery = useQuery({
    queryKey: ['sale-team-search-config'],
    queryFn: ({ signal }) =>
      request('/sale-team/search/config', saleTeamSearchConfigSchema, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const config = configQuery.data;
  const [session, setSession] = useState(loadSession);
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'privacy' | 'contact' | 'result'>('idle');
  const [acknowledged, setAcknowledged] = useState(false);
  const [searchToken, setSearchToken] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', mobile: '' });
  const [reuseContact, setReuseContact] = useState(false);
  const [result, setResult] = useState<PublicSaleTeamSearchResult | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [],
  );

  function saveSession(value: SearchSession) {
    setSession(value);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch {
      /* Keep only in memory. */
    }
  }
  function discard() {
    epoch.current++;
    controller.current?.abort();
    setBusy(false);
    setPhase('idle');
    setResult(null);
    setPhotoOpen(false);
    setSearchToken('');
    setAcknowledged(false);
    setContact({ name: '', email: '', mobile: '' });
    setError('');
  }
  function start(event: FormEvent) {
    event.preventDefault();
    const number = aaNumberSchema.safeParse(input);
    setInvalid(!number.success);
    if (!number.success || !config?.available || busy) return;
    discard();
    setPhase('privacy');
    setCaptchaToken(null);
    setCaptchaVersion((v) => v + 1);
  }
  async function reveal(details?: SaleTeamSearchContact) {
    if (!config || (!searchToken && !captchaToken) || busy) return;
    const active = epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      let token = searchToken;
      if (!token) {
        const started = await request('/sale-team/search/start', saleTeamSearchStartedSchema, {
          method: 'POST',
          body: JSON.stringify({ aaNumber: input, sessionId: session.sessionId, captchaToken }),
          signal: abort.signal,
        });
        if (epoch.current !== active) return;
        token = started.searchToken;
        setSearchToken(token);
      }
      const data = await request('/sale-team/search/reveal', saleTeamSearchRevealedSchema, {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.sessionId,
          searchToken: token,
          acknowledged: true,
          noticeVersion: config.noticeVersion,
          ...(details ? { contact: details } : { contactReceipt: session.receipt }),
        }),
        signal: abort.signal,
      });
      if (epoch.current !== active) return;
      saveSession({
        sessionId: session.sessionId,
        receipt: data.contactReceipt,
        expiresAt:
          session.receipt === data.contactReceipt ? session.expiresAt : Date.now() + 86400000,
      });
      setContact({ name: '', email: '', mobile: '' });
      setResult(data.result);
      setPhase('result');
    } catch (cause) {
      if (epoch.current !== active) return;
      if (cause instanceof ApiError && cause.status === 400) {
        saveSession({ sessionId: session.sessionId });
        setReuseContact(false);
        setSearchToken('');
        setPhase('contact');
      }
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Verification is unavailable. Retry this request or cancel.',
      );
    } finally {
      if (epoch.current === active) {
        setBusy(false);
        setCaptchaToken(null);
        setCaptchaVersion((value) => value + 1);
      }
    }
  }
  function continuePrivacy() {
    if (!acknowledged || busy) return;
    setReuseContact(!!session.receipt && Number(session.expiresAt) > Date.now());
    setPhase('contact');
  }
  function submitContact(event: FormEvent) {
    event.preventDefault();
    if (reuseContact) {
      void reveal();
      return;
    }
    const parsed = saleTeamSearchContactSchema.safeParse(contact);
    if (!parsed.success) {
      setError('Enter a valid name, email and mobile number.');
      return;
    }
    void reveal(parsed.data);
  }
  const dialogError = error ? <Alert variant="danger">{error}</Alert> : null;

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
        lede="Enter an AA number to confirm a seller's current accreditation."
      />
      <Container size="narrow" className="py-12 sm:py-16">
        {config?.localPreview ? (
          <Alert variant="info">
            Local preview — draft privacy notice. Use synthetic contact details only.
          </Alert>
        ) : null}
        <section
          aria-labelledby="sale-team-search-heading"
          className="rounded-[var(--radius-panel)] border border-line bg-cream-50 p-6 shadow-soft sm:p-8"
        >
          <p className="label-caps text-leaf-700">Accreditation check</p>
          <h2
            id="sale-team-search-heading"
            className="mt-3 font-display text-2xl font-medium text-navy-900 sm:text-3xl"
          >
            Search by AA number
          </h2>
          <p className="mt-2 text-body-sm text-ink-600">
            Enter the full AA number.{' '}
            {config?.dailyLimitEnabled !== false
              ? 'Up to 3 successful verifications per IP address in 24 hours.'
              : 'The daily search limit is currently disabled. Security checks still apply.'}
          </p>
          {config?.available ? (
            <>
              <p className="mt-3 text-body-sm text-ink-600">
                Select Search to read the privacy notice, enter your name, email and mobile number,
                and complete Cloudflare verification. Validated details are reused during this session.
              </p>
              <details className="mt-4 text-body-sm">
                <summary className="cursor-pointer">
                  Privacy notice — Data Privacy Act of 2012
                </summary>
                <div className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap" tabIndex={0}>
                  {config.privacyNotice}
                </div>
              </details>
            </>
          ) : null}
          {configQuery.isLoading ? <p role="status">Loading verification…</p> : null}
          {!configQuery.isLoading && !config?.available ? (
            <Alert variant="danger">
              Verification is currently unavailable. Please try again later.
            </Alert>
          ) : null}
          <form onSubmit={start} className="mt-6 flex flex-col gap-4">
            <TextField
              id="sale-team-aa"
              name="aaNumber"
              label="AA number"
              placeholder="AAI26100001 or AAO26100001"
              value={input}
              onChange={(value) => {
                discard();
                setInput(value);
                setInvalid(false);
              }}
              error={invalid ? 'Enter a valid AA number.' : undefined}
              autoComplete="off"
            />
            <Button type="submit" disabled={!config?.available || busy}>
              Search
            </Button>
          </form>
        </section>
        <div aria-live="polite" className="mt-8">
          {phase === 'idle' || phase === 'result' ? dialogError : null}
          {phase === 'result' && result ? (
            <article
              aria-label="Verified sales team member"
              className="rounded-[var(--radius-panel)] border border-line bg-cream-50 p-6 shadow-soft sm:p-8"
            >
              <span className="inline-flex rounded-full bg-leaf-100 px-3 py-1 text-xs font-semibold text-leaf-700">
                {result.kind === 'IST' ? 'Employee identity' : 'Accredited'}
              </span>
              <div className="mt-4 flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Enlarge profile photo"
                  disabled={!result.photoUrl || failedPhotoUrl === result.photoUrl}
                  onClick={() => setPhotoOpen(true)}
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-leaf-100 text-xl font-semibold text-leaf-700 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-default"
                >
                  <span aria-hidden="true">{result.maskedName.charAt(0)}</span>
                  {result.photoUrl ? (
                    <img
                      src={result.photoUrl}
                      alt={result.maskedName}
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.hidden = true;
                        setFailedPhotoUrl(result.photoUrl);
                      }}
                    />
                  ) : null}
                </button>
                <div
                  role="group"
                  aria-label="Seller identity"
                  className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-navy-900"
                >
                  <h2 className="font-display text-2xl font-medium">{result.maskedName}</h2>
                  <div className="text-base" aria-label={`AA number ${result.aaNumber}`}>
                    <AccreditationId value={result.aaNumber} />
                  </div>
                </div>
              </div>
              <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="label-caps text-ink-400">Valid until</dt>
                  <dd className="mt-2">
                    {result.kind === 'IST' ? 'No accreditation expiry' : result.expiresOn}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="label-caps text-ink-400">Company verification contact</dt>
                  <dd className="mt-2">
                    <a
                      className="font-semibold text-leaf-700 underline"
                      href={`tel:${config?.verificationPhone.replace(/[^+\d]/g, '')}`}
                    >
                      {config?.verificationPhone}
                    </a>
                  </dd>
                </div>
              </dl>
              <aside
                aria-label="Transaction safety notice"
                className="mt-6 rounded-xl border border-l-4 border-gold-500 bg-gold-100 p-5 text-ink-900"
              >
                <p className="text-body leading-relaxed">
                  <strong>
                    For your protection, conduct all transactions only through AFHomes and its
                    authorized processes.
                  </strong>{' '}
                  If anyone asks you to pay or transact outside AFHomes' official channels,{' '}
                  <strong>do not proceed</strong> and verify by calling the official AFHomes company
                  verification number shown above.
                </p>
              </aside>
            </article>
          ) : null}
          {phase === 'result' && !result ? (
            <p
              role="status"
              className="rounded-xl border border-dashed border-line p-8 text-center"
            >
              No current accredited seller found.
            </p>
          ) : null}
        </div>
      </Container>
      <Dialog
        open={photoOpen && !!result?.photoUrl}
        onClose={() => setPhotoOpen(false)}
        title="Profile photo"
      >
        {result?.photoUrl ? (
          <img
            src={result.photoUrl}
            alt={result.maskedName}
            className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain"
            onError={() => {
              setFailedPhotoUrl(result.photoUrl);
              setPhotoOpen(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={phase === 'privacy'}
        onClose={discard}
        title="Privacy notice"
        footer={
          <>
            <Button variant="secondary" onClick={discard}>
              Cancel
            </Button>
            <Button
              onClick={continuePrivacy}
              disabled={!acknowledged || busy}
              loading={busy}
              loadingLabel="Preparing search"
            >
              Continue
            </Button>
          </>
        }
      >
        <div className="whitespace-pre-wrap text-body-sm text-ink-700">{config?.privacyNotice}</div>
        <label className="mt-6 flex items-start gap-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I acknowledge that I have read the AFHomes IST/OST Accreditation Verification Privacy
            Notice and understand how my personal information may be processed for the purposes
            described in the notice. I understand that the verification service is intended to help
            confirm an individual's current accreditation status and that AFHomes may apply security
            measures to prevent misuse of the service.
          </span>
        </label>
        {dialogError}
      </Dialog>
      <Dialog
        open={phase === 'contact'}
        onClose={discard}
        title="Your contact details and security check"
      >
        {reuseContact ? (
          <p>
            Your details are already validated for this session. Complete the security check for
            this search.
          </p>
        ) : (
          <p className="mb-4 text-body-sm">
            Enter your details as the person conducting this search. Matching details are saved once
            and reused for later IST/OST verification searches.
          </p>
        )}
        <form onSubmit={submitContact} className="flex flex-col gap-4">
          {!reuseContact ? (
            <>
              <TextField
                id="search-contact-name"
                name="name"
                label="Name"
                value={contact.name}
                onChange={(name) => setContact((v) => ({ ...v, name }))}
                autoComplete="name"
              />
              <TextField
                id="search-contact-email"
                name="email"
                label="Email"
                type="email"
                value={contact.email}
                onChange={(email) => setContact((v) => ({ ...v, email }))}
                autoComplete="email"
              />
              <TextField
                id="search-contact-mobile"
                name="mobile"
                label="Mobile"
                type="tel"
                value={contact.mobile}
                onChange={(mobile) => setContact((v) => ({ ...v, mobile }))}
                autoComplete="tel"
              />
            </>
          ) : null}
          {phase === 'contact' && config?.available ? (
            <TurnstileChallenge
              siteKey={config.siteKey}
              onToken={setCaptchaToken}
              resetVersion={captchaVersion}
            />
          ) : null}
          {dialogError}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" type="button" onClick={discard}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={(!captchaToken && !searchToken) || busy}
              loading={busy}
              loadingLabel="Verifying"
            >
              Verify accreditation
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
