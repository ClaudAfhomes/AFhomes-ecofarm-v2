import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AuthLayout, Button, ErrorState } from '@jad/ui';
import { getSupabaseClient } from '../../lib/supabase';
import { useSession } from '../../lib/session';

export function AdminMfaPage() {
  const client = getSupabaseClient();
  const session = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const factors = useQuery({
    queryKey: ['auth', 'mfa-factors'],
    queryFn: async () => {
      if (!client) throw new Error('Authentication is not configured.');
      const result = await client.auth.mfa.listFactors();
      if (result.error) throw result.error;
      return result.data.totp;
    },
  });
  const enrollment = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error('Authentication is not configured.');
      const result = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'AF Homes administrator',
      });
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const factorId = enrollment.data?.id ?? factors.data?.[0]?.id;
  const verify = useMutation({
    mutationFn: async () => {
      if (!client || !factorId || !/^\d{6}$/.test(code))
        throw new Error('Enter the six-digit authenticator code.');
      const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) throw new Error('Authenticator verification failed. Try a fresh code.');
      await session.revalidate();
    },
    onSuccess: () => navigate('/admin', { replace: true }),
  });
  const qr = enrollment.data?.totp.qr_code;
  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Authenticator verification"
      brandTitle="Secure access to AF Homes."
      lead="Admin and Super Admin verification uses Supabase TOTP."
    >
      {factors.isPending && <p role="status">Loading authenticator setup…</p>}
      {factors.isError && <ErrorState error={factors.error} onRetry={factors.refetch} />}
      {factors.data && !factorId && (
        <Button onClick={() => enrollment.mutate()} disabled={enrollment.isPending}>
          Set up authenticator
        </Button>
      )}
      {qr && (
        <>
          <img
            alt="Scan with your authenticator app"
            src={
              qr.startsWith('data:image/')
                ? qr
                : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`
            }
          />
          <p>
            Scan this setup code with your authenticator app, then verify. The setup secret is shown
            only here.
          </p>
        </>
      )}
      {factorId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate();
          }}
        >
          <label>
            Authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={verify.isPending}>
            Verify
          </Button>
        </form>
      )}
      {enrollment.isError && (
        <p role="alert">Unable to enroll an authenticator. Retry or contact the account owner.</p>
      )}
      {verify.isError && <p role="alert">{verify.error.message}</p>}
    </AuthLayout>
  );
}
