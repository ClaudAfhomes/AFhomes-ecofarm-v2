import { afterEach, expect, it, vi } from 'vitest';
import { createCookieAuthGateway } from './cookie-auth.js';

const auth = createCookieAuthGateway('/api/v1');
afterEach(() => vi.unstubAllGlobals());

it('forwards a login challenge token only in the CAPTCHA header', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  await auth.signIn('synthetic@example.invalid', 'Synthetic123!', 'synthetic-captcha');
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  expect(options.headers).toMatchObject({ 'x-captcha-response': 'synthetic-captcha' });
  expect(JSON.parse(String(options.body))).toEqual({ email: 'synthetic@example.invalid', password: 'Synthetic123!' });
});

it.each(['MISSING_RESPONSE', 'VERIFICATION_FAILED'])('shows a retryable security message for %s without revealing upstream details', async (code) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code, message: 'private upstream detail' }, { status: 403 })));
  await expect(auth.signIn('synthetic@example.invalid', 'Synthetic123!', 'expired-token'))
    .rejects.toThrow('Security verification failed or expired. Please complete it again.');
});

it.each([
  ['network failure', () => Promise.reject(new TypeError('private upstream detail'))],
  ['API failure', () => Promise.resolve(new Response('private upstream detail', { status: 503 }))],
  ['invalid response', () => Promise.resolve(Response.json(null))],
])(
  'reports service unavailability for %s without exposing upstream details',
  async (_name, reply) => {
    vi.stubGlobal('fetch', vi.fn(reply));
    await expect(auth.signIn('synthetic@example.invalid', 'Synthetic123!')).rejects.toThrow(
      'The sign-in service is unavailable. Please try again shortly.',
    );
  },
);

it('distinguishes rate limiting from an invalid password', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'private detail' }, { status: 429 })),
  );
  await expect(auth.signIn('synthetic@example.invalid', 'Synthetic123!')).rejects.toThrow(
    'Too many sign-in attempts. Please wait before trying again.',
  );
});

it('does not expose an upstream credential rejection message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'User not found' }, { status: 401 })),
  );
  await expect(auth.signIn('synthetic@example.invalid', 'Synthetic123!')).rejects.toThrow(
    'Authentication request failed. Please try again.',
  );
});
