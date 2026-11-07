import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { useProfilePhoto } from './profile-photo';

const pending = vi.hoisted(() => ({ upload: null as Promise<unknown> | null }));

function captureUpload(upload: Promise<unknown>) {
  pending.upload = upload;
}

const staffUser: SessionUser = {
  id: 'staff-1',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'role-1',
  roleSlug: 'employee',
  roleName: 'Employee',
  afHomesPermissions: [],
  status: 'active',
  mustChangePassword: false,
};

const empty = { url: null, expiresAt: null, canUpload: true, notice: null };

function Probe() {
  const photo = useProfilePhoto();
  return createElement(
    'button',
    {
      onClick: () => {
        captureUpload(
          photo.upload.mutateAsync({
            dataBase64: 'synthetic-jpeg',
            expectedUserId: staffUser.id,
          }),
        );
      },
    },
    'Save synthetic photo',
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  pending.upload = null;
});

describe('staff profile-photo session boundary', () => {
  it('does not restore private photo data after logout clears an unmounted query', async () => {
    let finish: (response: Response) => void = () => {
      throw new Error('Upload not started');
    };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT')
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return new Response(JSON.stringify(empty), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    const client = createTestQueryClient();
    const view = renderWithProviders(<Probe />, { queryClient: client, user: staffUser });
    await waitFor(() =>
      expect(client.getQueryData(['profile-photo', 'staff', staffUser.id])).toEqual(empty),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save synthetic photo' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const body = JSON.parse(
      fetch.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body as string,
    );
    expect(body.expectedUserId).toBe(staffUser.id);
    view.unmount();
    client.clear();
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({ ...empty, url: 'https://storage.example.invalid/private-photo.jpg' }),
          { status: 200 },
        ),
      );
      await pending.upload;
    });
    expect(client.getQueryData(['profile-photo', 'staff', staffUser.id])).toBeUndefined();
  });
});
