import { createClient } from '@supabase/supabase-js';
import { AuthError } from '@supabase/auth-js';
import { afterEach, expect, it, vi } from 'vitest';
import { verifiedAssuranceLevel } from './auth-verify.js';
afterEach(() => vi.restoreAllMocks());
const auth = createClient('https://qa.example.invalid', 'qa-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).auth;
it.each(['aal1', 'aal2'])(
  'uses SDK-verified claims for %s rather than decoding an unverified token',
  async (aal) => {
    const claims = vi.spyOn(auth, 'getClaims').mockResolvedValue({
      data: {
        claims: {
          iss: 'https://qa.example.invalid/auth/v1',
          sub: '00000000-0000-4000-8000-000000000001',
          aud: 'authenticated',
          exp: 2000000000,
          iat: 1000000000,
          role: 'authenticated',
          session_id: 'qa-session',
          aal,
        },
        header: { alg: 'HS256', typ: 'JWT', kid: 'qa-key' },
        signature: new Uint8Array(),
      },
      error: null,
    });
    expect(await verifiedAssuranceLevel(auth, 'verified-qa-token')).toBe(aal);
    expect(claims).toHaveBeenCalledWith('verified-qa-token');
  },
);
it('fails closed when signature verification refuses the claimed assurance level', async () => {
  vi.spyOn(auth, 'getClaims').mockResolvedValue({
    data: null,
    error: new AuthError('Invalid signature'),
  });
  expect(await verifiedAssuranceLevel(auth, 'forged-aal2-token')).toBeNull();
});
