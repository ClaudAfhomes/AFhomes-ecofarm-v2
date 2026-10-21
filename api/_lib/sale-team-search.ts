import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import {
  aaNumberSchema,
  saleTeamSearchContactSchema,
  type SaleTeamSearchContact,
} from '@afhomes/contracts';
import type { VercelRequest } from './http.js';
import { DRAFT_SEARCH_NOTICE } from './sale-team-search-notice.js';

export function maskSearchName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = Array.from(words.pop() ?? '');
  if (!last.length) return 'Name unavailable';
  return [...words, last[0] + '*'.repeat(Math.max(1, last.length - 1))].join(' ');
}

export function searchDigest(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify([purpose, value]))
    .digest('hex');
}

export function contactDigest(secret: string, raw: SaleTeamSearchContact): string {
  const contact = saleTeamSearchContactSchema.parse(raw);
  return searchDigest(
    secret,
    'contact-dedup-v1',
    JSON.stringify([contact.name.normalize().toLowerCase(), contact.email, contact.mobile]),
  );
}

export function searchIp(req: VercelRequest, vercel = process.env.VERCEL === '1'): string {
  const raw = vercel
    ? (req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'])
    : req.socket?.remoteAddress;
  if (typeof raw !== 'string' || !isIP(raw) || raw.includes('%'))
    throw new Error('Trusted IP required');
  const ip = raw.toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 4) return ip;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (mapped) {
    const a = parseInt(mapped[1]!, 16),
      b = parseInt(mapped[2]!, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return normalized;
}

const tokenSchema = z
  .object({
    purpose: z.enum(['search', 'contact']),
    id: z.uuid(),
    sessionId: z.uuid(),
    ipHash: z.string().regex(/^[a-f0-9]{64}$/),
    noticeVersion: z.string().min(1).max(100),
    aaNumber: aaNumberSchema.optional(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
type Claims = z.infer<typeof tokenSchema>;
type Binding = Pick<Claims, 'sessionId' | 'ipHash' | 'noticeVersion'>;

export function signSearchToken(
  secret: string,
  claims: Omit<Claims, 'issuedAt' | 'expiresAt'>,
  ttl: number,
  now = Math.floor(Date.now() / 1000),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, issuedAt: now, expiresAt: now + ttl }),
  ).toString('base64url');
  return `${payload}.${searchDigest(secret, 'search-token-v1', payload)}`;
}

export function readSearchToken(
  secret: string,
  token: string,
  purpose: Claims['purpose'],
  binding: Binding,
  now = Math.floor(Date.now() / 1000),
): Claims {
  const parts = token.split('.');
  if (parts.length !== 2 || token.length > 4096) throw new Error('Invalid search session');
  const payload = parts[0]!,
    mac = parts[1]!;
  const expected = searchDigest(secret, 'search-token-v1', payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected)))
    throw new Error('Invalid search session');
  const claims = tokenSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (
    claims.purpose !== purpose ||
    claims.sessionId !== binding.sessionId ||
    claims.ipHash !== binding.ipHash ||
    claims.noticeVersion !== binding.noticeVersion ||
    claims.issuedAt > now ||
    claims.expiresAt <= now ||
    claims.expiresAt - claims.issuedAt > (purpose === 'search' ? 300 : 86400) ||
    (purpose === 'search' && !claims.aaNumber)
  )
    throw new Error('Invalid search session');
  return claims;
}

export async function verifySearchCaptcha(
  secret: string,
  token: string,
  hostnames: string[],
): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const data = z
      .object({ success: z.boolean(), hostname: z.string().optional() })
      .parse(await response.json());
    return data.success && typeof data.hostname === 'string' && hostnames.includes(data.hostname);
  } catch {
    return false;
  }
}

export function searchConfiguration() {
  const e = process.env;
  let loopback = false;
  try {
    loopback = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(e.SUPABASE_URL ?? '').hostname);
  } catch {
    /* unavailable */
  }
  const localPreview =
    e.AFHOMES_SEARCH_LOCAL_PREVIEW === 'true' && loopback && e.NODE_ENV !== 'production';
  const secret = e.AFHOMES_SEARCH_SECRET ?? '';
  const captchaSecret = e.AFHOMES_SEARCH_TURNSTILE_SECRET ?? '';
  const hostnames = (e.AFHOMES_SEARCH_TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const retentionDays = Number(e.AFHOMES_SEARCH_CONTACT_RETENTION_DAYS);
  const privacyNotice = (
    localPreview ? DRAFT_SEARCH_NOTICE : (e.AFHOMES_SEARCH_PRIVACY_NOTICE ?? '')
  ).replaceAll('{{CONTACT_RETENTION_DAYS}}', String(retentionDays));
  const noticeVersion =
    e.AFHOMES_SEARCH_NOTICE_VERSION ?? (localPreview ? 'local-draft-2026-10-21' : '');
  const siteKey = e.VITE_TURNSTILE_SITE_KEY ?? '';
  const verificationPhone = e.AFHOMES_VERIFICATION_PHONE ?? '';
  const finalized =
    e.AFHOMES_SEARCH_PRIVACY_APPROVED === 'true' &&
    e.AFHOMES_SEARCH_CLEANUP_READY === 'true' &&
    privacyNotice.length > 100 &&
    !/\[Insert|\bTBD\b/.test(privacyNotice);
  const testKeys = /^(1x|2x|3x)0{10}/.test(siteKey) || /^(1x|2x|3x)0{10}/.test(captchaSecret);
  const available =
    e.AFHOMES_SEARCH_ENABLED === 'true' &&
    secret.length >= 32 &&
    !!captchaSecret &&
    hostnames.length > 0 &&
    !!siteKey &&
    /^\+?[\d ()-]{7,30}$/.test(verificationPhone) &&
    noticeVersion.length > 0 &&
    noticeVersion.length <= 100 &&
    Number.isInteger(retentionDays) &&
    retentionDays >= 1 &&
    retentionDays <= 3650 &&
    (localPreview || finalized) &&
    (localPreview || !testKeys);
  return {
    available,
    localPreview,
    secret,
    captchaSecret,
    hostnames,
    retentionDays,
    public: {
      available,
      localPreview,
      noticeVersion: available ? noticeVersion : '',
      privacyNotice: available ? privacyNotice : '',
      verificationPhone: available ? verificationPhone : '',
      siteKey: available ? siteKey : '',
    },
  };
}
