import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contactDigest,
  maskSearchName,
  searchIp,
  signSearchToken,
  readSearchToken,
  verifySearchCaptcha,
} from './sale-team-search.js';

afterEach(() => vi.unstubAllGlobals());
const secret = 'synthetic-local-test-secret-at-least-32-characters';
const context = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  ipHash: 'a'.repeat(64),
  noticeVersion: 'test-v1',
};

describe('public search boundaries', () => {
  it('masks single names, Unicode and one-letter surnames without exposing a fallback name', () => {
    expect(maskSearchName('  Juan   Seller  ')).toBe('Juan S*****');
    expect(maskSearchName('Élodie')).toBe('É*****');
    expect(maskSearchName('Juan X')).toBe('Juan X*');
    expect(maskSearchName(' ')).toBe('Name unavailable');
  });
  it('deduplicates complete normalized contact combinations across formatting, not partial matches', () => {
    const a = { name: 'Juan Seller', email: 'test@example.invalid', mobile: '+639171234567' };
    expect(contactDigest(secret, a)).toBe(
      contactDigest(secret, {
        ...a,
        name: ' JUAN  SELLER ',
        email: ' TEST@example.invalid ',
        mobile: '0917 123 4567',
      }),
    );
    expect(contactDigest(secret, a)).not.toBe(
      contactDigest(secret, { ...a, name: 'Other Seller' }),
    );
  });
  it('trusts socket locally and platform headers only in the Vercel runtime; normalizes mapped IPv4', () => {
    const req = {
      query: {},
      headers: { 'x-forwarded-for': '203.0.113.1' },
      socket: { remoteAddress: '::ffff:127.0.0.1' },
    };
    expect(searchIp(req, false)).toBe('127.0.0.1');
    expect(searchIp(req, true)).toBe('203.0.113.1');
    expect(() =>
      searchIp({ ...req, headers: { 'x-forwarded-for': '203.0.113.1, 1.2.3.4' } }, true),
    ).toThrow();
    expect(() => searchIp({ query: {}, headers: {} }, false)).toThrow();
  });
  it('binds a signed flow to purpose, session, IP, notice version and expiry', () => {
    const token = signSearchToken(
      secret,
      { ...context, purpose: 'search', id: context.sessionId, aaNumber: 'AAI26100001' },
      300,
      1000,
    );
    expect(readSearchToken(secret, token, 'search', context, 1001).aaNumber).toBe('AAI26100001');
    expect(() => readSearchToken(secret, token + 'x', 'search', context, 1001)).toThrow();
    expect(() => readSearchToken(secret, token, 'contact', context, 1001)).toThrow();
    expect(() =>
      readSearchToken(secret, token, 'search', { ...context, ipHash: 'b'.repeat(64) }, 1001),
    ).toThrow();
    expect(() => readSearchToken(secret, token, 'search', context, 1300)).toThrow();
  });
  it('verifies CAPTCHA server-side and rejects a successful token from an unexpected hostname', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'attacker.invalid' }),
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await verifySearchCaptcha('server-secret', 'token', ['localhost'])).toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'server-secret', response: 'token' }),
      }),
    );
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: 'localhost' }),
    });
    expect(await verifySearchCaptcha('server-secret', 'token', ['localhost'])).toBe(true);
  });
});
