import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../supabase', () => ({
  getSupabaseClient: () => ({ auth: { getSession: auth.getSession } }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: auth.refresh,
  clearSession: auth.clear,
}));

import { createAfHomesStaff, deleteAfHomesStaff } from '../../features/afhomes/services';
import { protectedRequest, request } from './client';

const okSchema = z.object({ ok: z.literal(true) });
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const session = (accessToken: string | null) =>
  Promise.resolve({
    data: { session: accessToken ? { access_token: accessToken } : null },
    error: null,
  });
const headersAt = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
  fetchMock.mock.calls[index]![1]!.headers as Record<string, string>;

const staffResponse = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'staff@afhomes.test',
  fullName: 'Test Staff',
  status: 'active',
  departmentId: null,
  departmentName: null,
  roleId: 'aaaaaaaa-0000-4000-8000-000000000002',
  roleName: 'Admin',
  restrictions: [],
  mustChangePassword: true,
  invitedAt: null,
  activatedAt: '2026-09-30T00:00:00.000Z',
  createdAt: '2026-09-30T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockImplementation(() => session('current-token'));
  auth.refresh.mockResolvedValue(true);
  auth.clear.mockResolvedValue(undefined);
});

describe('required API authentication', () => {
  it.each(['DELETE', 'POST', 'PATCH'])('attaches a Bearer token to protected %s', async (method) => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await protectedRequest('/protected', okSchema, { method });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method });
    expect(headersAt(fetchMock, 0).Authorization).toBe('Bearer current-token');
  });

  it('refreshes before the first request when storage has no access token', async () => {
    auth.getSession
      .mockImplementationOnce(() => session(null))
      .mockImplementationOnce(() => session('refreshed-token'));
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await protectedRequest('/protected', okSchema, { method: 'DELETE' });

    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(headersAt(fetchMock, 0).Authorization).toBe('Bearer refreshed-token');
  });

  it('does not send a protected request when refresh cannot recover a token', async () => {
    auth.getSession.mockImplementation(() => session(null));
    auth.refresh.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(protectedRequest('/protected', okSchema, { method: 'DELETE' })).rejects.toMatchObject(
      {
        status: 401,
        message: 'Your session has expired. Please sign in again.',
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once after a 401 and retries with the new token', async () => {
    auth.getSession
      .mockImplementationOnce(() => session('stale-token'))
      .mockImplementationOnce(() => session('new-token'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: { code: 'UNAUTHORIZED' } }, 401))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await protectedRequest('/protected', okSchema, { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(headersAt(fetchMock, 0).Authorization).toBe('Bearer stale-token');
    expect(headersAt(fetchMock, 1).Authorization).toBe('Bearer new-token');
  });

  it('stops after a second 401 and exposes no token or header in the error', async () => {
    auth.getSession
      .mockImplementationOnce(() => session('stale-secret-token'))
      .mockImplementationOnce(() => session('new-secret-token'));
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'UNAUTHORIZED' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const failure = await protectedRequest('/protected', okSchema, { method: 'PATCH' }).catch(
      (error: unknown) => error,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(auth.clear).toHaveBeenCalledTimes(1);
    expect(String(failure)).toBe('ApiError: Your session has expired. Please sign in again.');
    expect(JSON.stringify(failure)).not.toMatch(/stale-secret-token|new-secret-token|Authorization/i);
  });

  it('allows an explicitly public request to run without a session', async () => {
    auth.getSession.mockImplementation(() => session(null));
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/public', okSchema);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headersAt(fetchMock, 0)).not.toHaveProperty('Authorization');
    expect(auth.refresh).not.toHaveBeenCalled();
  });
});

describe('AF Homes staff services require authentication', () => {
  it('sends staff deletion as an authenticated DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ deleted: true }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteAfHomesStaff(staffResponse.id);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
    expect(headersAt(fetchMock, 0).Authorization).toBe('Bearer current-token');
  });

  it('sends staff creation as an authenticated POST without logging its token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(staffResponse));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchMock);

    await createAfHomesStaff({
      email: staffResponse.email,
      fullName: staffResponse.fullName,
      departmentId: null,
      roleId: staffResponse.roleId,
      temporaryPassword: 'Temporary123',
    });

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    expect(headersAt(fetchMock, 0).Authorization).toBe('Bearer current-token');
    expect([log, warn, error].flatMap((spy) => spy.mock.calls).join(' ')).not.toContain(
      'current-token',
    );
  });
});
