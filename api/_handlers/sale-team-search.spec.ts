import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import { resetIdentifierRateLimit } from '../_lib/rate-limit.js';
const holder = vi.hoisted(() => ({ db: null as FakeSupabase | null }));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
const handler = (await import('./sale-team.js')).default;
const sessionId = '11111111-1111-4111-8111-111111111111';
const record = {
  aaNumber: 'AAI26100001',
  kind: 'IST',
  fullName: 'Synthetic Seller',
  status: 'accredited',
  startsOn: null,
  expiresOn: null,
};
const savedSettings = {
  privacyApproved: true,
  cleanupReady: true,
  enabled: true,
  dailyLimitEnabled: true,
  verificationPhone: '+639604316867',
  retentionDays: 30,
  privacyNotice: 'Synthetic approved notice for a configuration test. '.repeat(5),
  noticeVersion: 'approved-v1',
  revision: 1,
  updatedAt: '2026-10-22T00:00:00.000Z',
};
beforeEach(() => {
  vi.stubEnv('AFHOMES_SEARCH_PRIVACY_APPROVED', undefined);
  vi.stubEnv('AFHOMES_SEARCH_CLEANUP_READY', undefined);
  savedSettings.privacyApproved = true;
  savedSettings.cleanupReady = true;
  savedSettings.enabled = true;
  savedSettings.retentionDays = 30;
  savedSettings.dailyLimitEnabled = true;
  savedSettings.privacyNotice = 'Synthetic approved notice for a configuration test. '.repeat(5);
  resetIdentifierRateLimit();
  for (const [key, value] of Object.entries({
    AFHOMES_SEARCH_ENABLED: 'true',
    AFHOMES_SEARCH_LOCAL_PREVIEW: 'true',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    AFHOMES_SEARCH_SECRET: 'synthetic-secret-with-more-than-32-characters',
    AFHOMES_SEARCH_TURNSTILE_SECRET: 'synthetic-secret',
    AFHOMES_SEARCH_TURNSTILE_HOSTNAMES: 'localhost',
    VITE_TURNSTILE_SITE_KEY: 'synthetic-site',
    AFHOMES_VERIFICATION_PHONE: '+639604316867',
    AFHOMES_SEARCH_CONTACT_RETENTION_DAYS: '30',
    VERCEL: '',
  }))
    vi.stubEnv(key, value);
  holder.db = new FakeSupabase({
    tables: {},
    rpcs: [
      { fn: 'get_public_verification_settings', result: () => ({ ...savedSettings }) },
      { fn: 'begin_sale_team_search', result: { allowed: true, retryAfter: 0 } },
      { fn: 'save_sale_team_search_contact', result: sessionId },
      { fn: 'sale_team_search_contact_exists', result: true },
      { fn: 'reveal_sale_team_search', result: { limited: false, retryAfter: 0, result: record } },
    ],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'localhost' }),
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function call(path: string, body?: unknown, method = 'POST') {
  const { res, state } = makeRes();
  await handler(
    { ...makeReq({ familyPath: path, method, body }), socket: { remoteAddress: '127.0.0.1' } },
    res,
  );
  return state;
}
async function start() {
  const state = await call('search/start', {
    aaNumber: record.aaNumber,
    sessionId,
    captchaToken: 'captcha',
  });
  expect(state.status).toBe(200);
  return (state.body as { searchToken: string }).searchToken;
}
it('withholds seller data until acknowledgment and validated contact; cached contact still needs a new CAPTCHA', async () => {
  const searchToken = await start();
  expect(searchToken).not.toContain('Synthetic');
  expect(holder.db?.calls.some((c) => c.table === 'reveal_sale_team_search')).toBe(false);
  const body = {
    sessionId,
    searchToken,
    acknowledged: true,
    noticeVersion: 'approved-v1',
    contact: {
      name: 'Synthetic Searcher',
      email: 'searcher@example.invalid',
      mobile: '09171234567',
    },
  };
  expect((await call('search/reveal', { ...body, acknowledged: false })).status).toBe(400);
  const first = await call('search/reveal', body);
  expect(first.status).toBe(200);
  expect(JSON.stringify(first.body)).not.toContain('Synthetic Seller');
  expect((first.body as { result: { maskedName: string } }).result.maskedName).toBe(
    'Synthetic S*****',
  );
  const receipt = (first.body as { contactReceipt: string }).contactReceipt;
  const next = await start();
  expect(
    (
      await call('search/reveal', {
        sessionId,
        searchToken: next,
        acknowledged: true,
        noticeVersion: body.noticeVersion,
        contactReceipt: receipt,
      })
    ).status,
  ).toBe(200);
  expect(holder.db?.calls.filter((c) => c.table === 'save_sale_team_search_contact')).toHaveLength(
    1,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('rejects bad CAPTCHA before any search or contact RPC', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
  );
  expect(
    (await call('search/start', { aaNumber: record.aaNumber, sessionId, captchaToken: 'bad' }))
      .status,
  ).toBe(400);
  expect(holder.db?.calls.filter((c) => c.op === 'rpc').map((c) => c.table)).toEqual([
    'get_public_verification_settings',
  ]);
});
it('closes the old anonymous GET even when the new feature configuration is incomplete', async () => {
  vi.stubEnv('AFHOMES_SEARCH_SECRET', '');
  const state = await call('search', undefined, 'GET');
  expect(state.status).toBe(401);
  expect(holder.db?.calls.some((c) => c.op === 'rpc')).toBe(false);
});
it('fails closed on hosted draft configuration and never exposes server secrets in config', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  savedSettings.privacyNotice = '[Insert finalized privacy notice here]';
  const state = await call('search/config', undefined, 'GET');
  expect((state.body as { available: boolean }).available).toBe(false);
  expect(JSON.stringify(state.body)).not.toContain('synthetic-secret');
});
it('uses saved controls immediately and ignores old environment control values', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('AFHOMES_SEARCH_ENABLED', 'false');
  vi.stubEnv('AFHOMES_VERIFICATION_PHONE', 'obsolete');
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({
    available: true,
    verificationPhone: savedSettings.verificationPhone,
  });
  savedSettings.enabled = false;
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({ available: false });
  expect((await call('search/reveal', {})).status).toBe(503);
});
it('fails closed when database settings cannot be read even if the old env switch is enabled', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  holder.db!.rpcErrors.get_public_verification_settings = { message: 'storage unavailable' };
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({ available: false });
});
it.each(['privacyApproved', 'cleanupReady'] as const)(
  'requires saved %s even if obsolete env flags claim readiness',
  async (field) => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('AFHOMES_SEARCH_PRIVACY_APPROVED', 'true');
    vi.stubEnv('AFHOMES_SEARCH_CLEANUP_READY', 'true');
    savedSettings[field] = false;
    expect((await call('search/config', undefined, 'GET')).body).toMatchObject({
      available: false,
    });
    expect((await call('search/start', {})).status).toBe(503);
    expect((await call('search/reveal', {})).status).toBe(503);
    expect(
      holder.db!.calls.some(
        (c) =>
          c.op === 'rpc' &&
          [
            'begin_sale_team_search',
            'save_sale_team_search_contact',
            'reveal_sale_team_search',
          ].includes(c.table),
      ),
    ).toBe(false);
  },
);
it('refuses Cloudflare test keys on hosted targets even with publication settings approved', async () => {
  vi.stubEnv('AFHOMES_SEARCH_TURNSTILE_SECRET', '1x0000000000000000000000000000000AA');
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({ available: true });
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('AFHOMES_SEARCH_NOTICE_VERSION', 'approved-v1');
  vi.stubEnv(
    'AFHOMES_SEARCH_PRIVACY_NOTICE',
    'Synthetic approved notice for a configuration test. '.repeat(5),
  );
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({ available: false });
  vi.stubEnv('AFHOMES_SEARCH_TURNSTILE_SECRET', 'synthetic-real-secret');
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'synthetic-real-site');
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({ available: true });
});
it.each(['7', '30', '90'])(
  'renders the configured %s-day contact retention in the public notice',
  async (days) => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('AFHOMES_SEARCH_NOTICE_VERSION', 'approved-v1');
    vi.stubEnv('AFHOMES_SEARCH_CONTACT_RETENTION_DAYS', days);
    savedSettings.retentionDays = Number(days);
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'synthetic-real-site');
    vi.stubEnv('AFHOMES_SEARCH_TURNSTILE_SECRET', 'synthetic-real-secret');
    savedSettings.privacyNotice =
      'Contact retention is {{CONTACT_RETENTION_DAYS}} days. This synthetic notice describes the verification purpose, limited recipients and privacy contact.';
    const state = await call('search/config', undefined, 'GET');
    expect(state.body).toMatchObject({
      available: true,
      privacyNotice: `Contact retention is ${days} days. This synthetic notice describes the verification purpose, limited recipients and privacy contact.`,
    });
  },
);
it('publishes the disabled daily limit and matching privacy wording from saved settings', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'synthetic-real-site');
  vi.stubEnv('AFHOMES_SEARCH_TURNSTILE_SECRET', 'synthetic-real-secret');
  savedSettings.dailyLimitEnabled = false;
  savedSettings.privacyNotice =
    'Synthetic finalized privacy notice. '.repeat(4) +
    'Current verification permits three successful disclosures per IP address in a rolling 24 hours.';
  const state = await call('search/config', undefined, 'GET');
  expect(state.body).toMatchObject({ available: true, dailyLimitEnabled: false });
  expect(state.body).toMatchObject({
    privacyNotice: expect.stringContaining(
      'daily successful-verification limit is currently disabled',
    ),
  });
  expect(state.body).not.toMatchObject({
    privacyNotice: expect.stringContaining('permits three successful'),
  });
});
it('returns 429 without a result when the disclosure allowance is exhausted', async () => {
  const searchToken = await start();
  holder.db!.rpcs.find((r) => r.fn === 'reveal_sale_team_search')!.result = {
    limited: true,
    retryAfter: 120,
    result: null,
  };
  const state = await call('search/reveal', {
    sessionId,
    searchToken,
    acknowledged: true,
    noticeVersion: 'approved-v1',
    contact: {
      name: 'Synthetic Searcher',
      email: 'searcher@example.invalid',
      mobile: '09171234567',
    },
  });
  expect(state.status).toBe(429);
  expect(state.headers['retry-after']).toBe('120');
});

it('uses saved support and payment settings in loopback preview too', async () => {
  holder.db!.rpcs.find((r) => r.fn === 'get_public_verification_settings')!.result = {
    ...savedSettings,
    supportHeading: 'Saved Support Desk',
    supportEmail: 'desk@example.invalid',
    bank1Name: 'Updated Bank',
    bank1Account: '00112233',
    agentReminder: 'Pay the company directly.',
  };
  expect((await call('search/config', undefined, 'GET')).body).toMatchObject({
    available: true,
    localPreview: true,
    privacyNotice: savedSettings.privacyNotice.trim(),
    supportHeading: 'Saved Support Desk',
    supportEmail: 'desk@example.invalid',
    bank1Name: 'Updated Bank',
    bank1Account: '00112233',
    agentReminder: 'Pay the company directly.',
  });
});
