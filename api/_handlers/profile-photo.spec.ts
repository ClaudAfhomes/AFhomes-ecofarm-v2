import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_PHOTO_MAX_BYTES, profilePhotoSchema } from '@afhomes/contracts';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';
import {
  phase2World,
  phase2WorldTokens,
  TOKEN,
  TOKEN2,
  UUID,
} from '../_lib/testing/phase2-fixtures.js';
import { resetIdentifierRateLimit } from '../_lib/rate-limit.js';
const holder = vi.hoisted(() => ({
  db: null as FakeSupabase | null,
  objects: new Map<string, Uint8Array>(),
  uploads: [] as { path: string; options: unknown }[],
  uploadError: false,
  signError: false,
  unavailable: false,
}));
vi.mock('../_lib/rest.js', () => ({ serviceClient: () => holder.db, anonClient: () => holder.db }));
vi.mock('../_lib/storage.js', () => ({
  storageClient: () =>
    holder.unavailable
      ? null
      : {
          from: (bucket: string) => {
            expect(bucket).toBe('afhomes-profile-photos');
            return {
              upload: async (path: string, bytes: Uint8Array, options: unknown) => {
                holder.uploads.push({ path, options });
                if (holder.uploadError)
                  return { data: null, error: { message: 'private storage failure' } };
                holder.objects.set(path, Uint8Array.from(bytes));
                return { data: { path }, error: null };
              },
              list: async (folder: string) => ({
                data: holder.objects.has(`${folder}/profile.jpg`) ? [{ name: 'profile.jpg' }] : [],
                error: null,
              }),
              createSignedUrl: async (path: string, ttl: number) => {
                expect(ttl).toBe(300);
                return holder.signError
                  ? { data: null, error: { message: 'private signing failure' } }
                  : {
                      data: {
                        signedUrl: `https://storage.example.invalid/${path}?token=synthetic`,
                      },
                      error: null,
                    };
              },
            };
          },
        },
}));
const handler = (await import('./profile-photo.js')).default;
const customerAuth = 'ffffffff-0000-4000-8000-000000000001';
const customerId = 'cccccccc-0000-4000-8000-000000000001';
const jpeg = (size = 39, width = 1) => {
  const header = Buffer.from([
    255,
    216,
    255,
    192,
    0,
    17,
    8,
    0,
    1,
    width >> 8,
    width & 255,
    3,
    1,
    17,
    0,
    2,
    17,
    1,
    3,
    17,
    1,
    255,
    218,
    0,
    12,
    3,
    1,
    0,
    2,
    17,
    3,
    17,
    0,
    63,
    0,
  ]);
  return Buffer.concat([header, Buffer.alloc(size - header.length - 2), Buffer.from([255, 217])]);
};
beforeEach(() => {
  resetIdentifierRateLimit();
  holder.objects.clear();
  holder.uploads = [];
  holder.uploadError = false;
  holder.signError = false;
  holder.unavailable = false;
  holder.db = new FakeSupabase({
    tables: phase2World({
      customers: [
        {
          id: customerId,
          auth_user_id: customerAuth,
          email: 'synthetic@example.invalid',
          customer_number: 'SYNTHETIC',
          status: 'active',
        },
      ],
    }),
    tokens: {
      ...phase2WorldTokens(),
      'customer-token': { id: customerAuth, email: 'synthetic@example.invalid' },
    },
  });
});
async function call(scope = 'staff', opts: Parameters<typeof makeReq>[0] = {}) {
  const { res, state } = makeRes();
  await handler(makeReq({ familyPath: scope, token: TOKEN.superAdmin, ...opts }), res);
  return state;
}
const put = (token: string = TOKEN.superAdmin, scope = 'staff', bytes = jpeg()) =>
  call(scope, {
    method: 'PUT',
    token,
    body: {
      dataBase64: bytes.toString('base64'),
      expectedUserId: token === 'customer-token' ? customerAuth : phase2WorldTokens()[token]?.id,
    },
  });
describe('private profile photos', () => {
  it('requires authentication before accessing storage', async () => {
    expect((await call('staff', { token: undefined })).status).toBe(401);
    expect(holder.uploads).toHaveLength(0);
  });
  it('ignores caller IDs and isolates owner photos', async () => {
    await put(TOKEN.viewer);
    const result = await call('staff', {
      query: { userId: UUID.viewerStaff, path: `${UUID.viewerStaff}/profile.jpg` },
    });
    expect(result.body).toMatchObject({ url: null, canUpload: true });
    expect(holder.objects.has(`${UUID.viewerStaff}/profile.jpg`)).toBe(true);
  });
  it('replaces one owner object without creating history files', async () => {
    expect((await put()).status).toBe(200);
    expect((await put(TOKEN.superAdmin, 'staff', jpeg(50))).status).toBe(200);
    expect(holder.objects.size).toBe(1);
    expect(holder.objects.get(`${UUID.superAdminStaff}/profile.jpg`)).toHaveLength(50);
    expect(holder.uploads[1]).toEqual({
      path: `${UUID.superAdminStaff}/profile.jpg`,
      options: { contentType: 'image/jpeg', cacheControl: '0', upsert: true },
    });
    const result = await call();
    expect(profilePhotoSchema.safeParse(result.body).success).toBe(true);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('leaves the previous photo intact after a definite upload failure', async () => {
    await put();
    const before = holder.objects.get(`${UUID.superAdminStaff}/profile.jpg`);
    holder.uploadError = true;
    expect((await put(TOKEN.superAdmin, 'staff', jpeg(50))).status).toBe(503);
    expect(holder.objects.get(`${UUID.superAdminStaff}/profile.jpg`)).toEqual(before);
  });
  it('reports saved bytes when preview signing fails, allowing a read retry', async () => {
    holder.signError = true;
    const result = await put();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      url: null,
      notice: 'Photo saved. Refresh the preview to view it.',
    });
    expect(holder.objects.size).toBe(1);
  });
  it('accepts the exact 0.5 MB limit and refuses one byte beyond', async () => {
    expect((await put(TOKEN.superAdmin, 'staff', jpeg(PROFILE_PHOTO_MAX_BYTES))).status).toBe(200);
    expect((await put(TOKEN.superAdmin, 'staff', jpeg(PROFILE_PHOTO_MAX_BYTES + 1))).status).toBe(
      400,
    );
    expect(holder.uploads).toHaveLength(1);
  });
  it.each([Buffer.from('not an image'), jpeg(39, 2048)])(
    'rejects invalid or oversized JPEG geometry',
    async (bytes) => {
      expect((await put(TOKEN.superAdmin, 'staff', bytes)).status).toBe(400);
      expect(holder.uploads).toHaveLength(0);
    },
  );
  it('refuses a tampered owner or storage path in the upload body', async () => {
    expect(
      (
        await call('staff', {
          method: 'PUT',
          body: {
            dataBase64: jpeg().toString('base64'),
            expectedUserId: UUID.superAdminStaff,
            userId: UUID.viewerStaff,
          },
        })
      ).status,
    ).toBe(400);
  });
  it.each(Object.entries(TOKEN2))(
    'supports the %s staff account type without granting another owner',
    async (role, token) => {
      expect((await put(token)).status).toBe(200);
      const owner = phase2WorldTokens()[token]!.id;
      expect(holder.objects.has(`${owner}/profile.jpg`)).toBe(true);
    },
  );
  it('refuses an account switch between selection and upload', async () => {
    expect(
      (
        await call('staff', {
          method: 'PUT',
          body: { dataBase64: jpeg().toString('base64'), expectedUserId: UUID.viewerStaff },
        })
      ).status,
    ).toBe(409);
    expect(holder.uploads).toHaveLength(0);
  });
  it('keeps customer authorization separate and derives its own Auth path', async () => {
    expect((await put('customer-token', 'customer')).status).toBe(200);
    expect(holder.objects.has(`${customerAuth}/profile.jpg`)).toBe(true);
    expect((await put('customer-token', 'staff')).status).toBe(403);
    expect((await put(TOKEN.superAdmin, 'customer')).status).toBe(403);
  });
  it('suspended customers may read but cannot replace a photo', async () => {
    holder.db!.rows('customers').find((c) => c.id === customerId)!.status = 'suspended';
    expect((await call('customer', { token: 'customer-token' })).body).toMatchObject({
      canUpload: false,
    });
    expect((await put('customer-token', 'customer')).status).toBe(403);
  });
  it('blocks forced-password writes while preserving recovery-page reads', async () => {
    holder
      .db!.rows('staff_users')
      .find((c) => c.id === UUID.superAdminStaff)!.must_change_password = true;
    expect((await call()).body).toMatchObject({ canUpload: false });
    expect((await put()).status).toBe(403);
  });
  it('enforces administrative MFA before changing an image', async () => {
    holder.db = new FakeSupabase({
      tables: phase2World({}),
      tokens: phase2WorldTokens(),
      rpcs: [{ fn: 'afhomes_admin_mfa_required', result: true }],
    });
    expect((await call()).body).toMatchObject({ canUpload: false });
    expect((await put()).status).toBe(403);
    expect(holder.uploads).toHaveLength(0);
  });
  it('refuses suspended staff even with a valid token', async () => {
    holder.db!.rows('staff_users').find((c) => c.id === UUID.viewerStaff)!.status = 'suspended';
    expect((await call('staff', { token: TOKEN.viewer })).status).toBe(403);
  });
  it('fails safely when private Storage is unavailable', async () => {
    holder.unavailable = true;
    expect((await call()).status).toBe(503);
  });
  it('bounds repeated authenticated uploads', async () => {
    for (let i = 0; i < 30; i++) expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(429);
    expect(holder.objects.size).toBe(1);
  });
});
