import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';

const MEDIA = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'hero.png',
  publicUrl: 'https://portal.afhomes.test/media/44444444-4444-4444-8444-444444444444.png',
  mimeType: 'image/png',
  mediaType: 'image' as const,
  altText: 'Resort hero',
  category: 'website',
  sizeBytes: 2048,
  width: 1200,
  height: 800,
  status: 'published' as const,
  uploadedBy: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
};

const USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Media Admin',
  email: 'media@afhomes.test',
  roleId: 'r1',
  roleName: 'Super Admin',
  afHomesPermissions: [
    {
      moduleKey: 'cms.media',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
  ],
  status: 'active',
};

const requests: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  requests.splice(0);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body });
    if (url.includes('/media') && method === 'GET')
      return Response.json({ data: [MEDIA], meta: { total: 1 } });
    if (url.includes('/media') && method === 'POST') return Response.json(MEDIA, { status: 201 });
    if (url.includes('/media') && method === 'PATCH')
      return Response.json({ ...MEDIA, status: 'unpublished' });
    if (url.includes('/media') && method === 'DELETE')
      return Response.json({ deleted: true });
    return Response.json({ data: [], meta: { total: 0 } });
  });
});

describe('media library page', () => {
  it('lists public media and uploads a selected file through the authorized endpoint', async () => {
    const actor = userEvent.setup();
    renderWithProviders(<App />, { route: '/admin/media', user: USER });

    expect(await screen.findByRole('heading', { name: 'Media Library' })).toBeInTheDocument();
    expect(await screen.findByText('hero.png')).toBeInTheDocument();
    expect(screen.getByAltText('Resort hero')).toHaveAttribute('src', MEDIA.publicUrl);

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' });
    await actor.upload(document.querySelector('#media-file') as HTMLInputElement, file);
    await actor.type(screen.getByLabelText(/Alternative text/), 'New hero');
    await actor.click(screen.getByRole('button', { name: 'Upload media' }));

    await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true));
    const upload = requests.find((request) => request.method === 'POST')!;
    expect(upload.url).toContain('/media?');
    expect(upload.url).toContain('name=new.png');
    expect(upload.url).toContain('alt=New%20hero');
    expect(upload.body).toBeInstanceOf(File);
  });
});
