import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithProviders } from '../../test/utils';
import { ProfilePhotoCard } from './ProfilePhotoCard';
const pending = vi.hoisted(() => ({ upload: null as Promise<unknown> | null }));
vi.mock('@afhomes/ui', async () => {
  const { createElement } = await import('react');
  return {
    ProfilePhotoEditor: ({ onUpload }: { onUpload: (data: string) => Promise<unknown> }) =>
      createElement(
        'button',
        {
          onClick: () => {
            pending.upload = onUpload('synthetic-jpeg');
          },
        },
        'Save synthetic photo',
      ),
  };
});
const owner = 'ffffffff-0000-4000-8000-000000000001';
const empty = { url: null, expiresAt: null, canUpload: true, notice: null };
beforeEach(() => {
  vi.restoreAllMocks();
  pending.upload = null;
});
describe('profile-photo client persistence and session boundary', () => {
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
    const view = renderWithProviders(<ProfilePhotoCard />, {
      queryClient: client,
      sessionUser: { authUserId: owner, email: 'synthetic@example.invalid' },
    });
    await waitFor(() =>
      expect(client.getQueryData(['profile-photo', 'customer', owner])).toEqual(empty),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save synthetic photo' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const body = JSON.parse(
      fetch.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!.body as string,
    );
    expect(body.expectedUserId).toBe(owner);
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
    expect(client.getQueryData(['profile-photo', 'customer', owner])).toBeUndefined();
  });
});
