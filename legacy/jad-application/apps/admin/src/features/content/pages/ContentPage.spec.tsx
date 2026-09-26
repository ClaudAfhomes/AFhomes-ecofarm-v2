import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MOCK_ADMIN } from '@jad/mock';

import { resetContentStore } from '../../../mock/contentMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { createContent } from '../services/content';
import { ContentPage } from './ContentPage';

vi.mock('../../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supabase')>();
  return {
    ...actual,
    getSupabaseClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      },
    }),
  };
});

/**
 * Layer storage upload over the mock API: the mock server passes
 * `/api/v1/cms/*` through to real fetch, which has no server in tests.
 */
function stubStorageUpload(
  signImpl: () => Response = () =>
    Response.json({ signedUrl: 'https://cdn.test/put', publicUrl: 'https://cdn.test/new.jpg' }),
  putImpl: () => Response = () => new Response(null, { status: 200 }),
) {
  const mockFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/cms/upload/sign')) return signImpl();
    if (url === 'https://cdn.test/put') return putImpl();
    return (mockFetch as typeof fetch)(input, init);
  }) as typeof fetch;
}

async function publishViaDialog(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByText('New Content'));
  await screen.findByText('New Marketing Tool');
  await user.type(screen.getByLabelText('Title'), title);
  await user.selectOptions(screen.getByLabelText('Type'), 'IMAGE');
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));
  await user.click(screen.getByRole('button', { name: 'Publish' }));
}

describe('ContentPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetContentStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Marketing Tools')).toBeInTheDocument();
    expect(screen.getByText(/Ready-to-share/)).toBeInTheDocument();
  });

  it('renders content table with data', async () => {
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('JA&D Membership Overview')).toBeInTheDocument();
    expect(screen.getByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.getByText('JA&D Opportunity Video')).toBeInTheDocument();
  });

  it('shows content kind chips with file-type icons', async () => {
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');
    expect(screen.getAllByText('Document').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Image').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Video').length).toBeGreaterThanOrEqual(1);
  });

  it('shows filter pills and always-visible pagination footer', async () => {
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/12 items page/)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('filters by kind', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Images' }));
    expect(screen.getByRole('button', { name: 'Images' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.queryByText('JA&D Opportunity Video')).not.toBeInTheDocument();
    expect(screen.getByText(/2 items page/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('JA&D Opportunity Video')).toBeInTheDocument();
  });

  it('opens New Content dialog with required file field and multi-select', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByText('New Content'));

    expect(await screen.findByText('New Marketing Tool')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByText('Files (required)')).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.multiple).toBe(true);
  });

  it('file input has correct accept attribute per type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByText('New Content'));
    await screen.findByText('New Marketing Tool');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.accept).toBe('.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx');

    await user.selectOptions(screen.getByLabelText('Type'), 'IMAGE');
    expect(fileInput.accept).toBe('image/jpeg,image/png,image/webp');

    await user.selectOptions(screen.getByLabelText('Type'), 'VIDEO');
    expect(fileInput.accept).toBe('video/mp4,video/webm,video/quicktime');
  });

  it('Publish button disabled when no files selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByText('New Content'));
    await screen.findByText('New Marketing Tool');

    const publishBtn = screen.getByRole('button', { name: 'Publish' });
    expect(publishBtn).toBeDisabled();
  });

  it('shows persisted content after refetch (regression: refresh must not lose items)', async () => {
    const created = await createContent({
      title: 'Persistence Probe Showcase',
      kind: 'IMAGE',
      downloadUrl: 'https://cdn.test/persistence-probe.jpg',
    });

    const first = renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Persistence Probe Showcase')).toBeInTheDocument();
    first.unmount();

    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Persistence Probe Showcase')).toBeInTheDocument();
    expect(created.share?.copyUrl).toBe('https://cdn.test/persistence-probe.jpg');
  });

  it('returns to page 1 after publishing so the newest item is visible (regression: stale page hid new items)', async () => {
    stubStorageUpload();
    // 13 items → 2 pages; park the list on page 2 like a browsing admin.
    await createContent({
      title: 'Seed Extra',
      kind: 'DOCUMENT',
      downloadUrl: 'https://cdn.test/extra.pdf',
    });
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('Seed Extra');

    await user.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText(/page 2 of 2/)).toBeInTheDocument();

    await publishViaDialog(user, 'Page Reset Probe');

    expect(await screen.findByText('Page Reset Probe')).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 2/)).toBeInTheDocument();
  });

  it('clears the kind filter after publishing so other-kind items are visible (regression: stale filter hid new items)', async () => {
    stubStorageUpload();
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Documents' }));
    expect(screen.getByRole('button', { name: 'Documents' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await publishViaDialog(user, 'Filter Reset Probe');

    expect(await screen.findByText('Filter Reset Probe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('surfaces the server rejection message when signing fails', async () => {
    stubStorageUpload(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Promos must be a document, image, or video file',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByText('New Content'));
    await screen.findByText('New Marketing Tool');
    await user.type(screen.getByLabelText('Title'), 'Rejected Probe');
    await user.selectOptions(screen.getByLabelText('Type'), 'PROMO');
    // PROMO accepts */* so the picker lets this through; the server rejects it.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dropped = new File(['bytes'], 'tool.exe', { type: 'application/x-msdownload' });
    Object.defineProperty(fileInput, 'files', { value: [dropped], configurable: true });
    fireEvent.change(fileInput);
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(
      await screen.findByText(/Promos must be a document, image, or video file/),
    ).toBeInTheDocument();
  });

  it('surfaces the storage PUT rejection body instead of the generic message', async () => {
    stubStorageUpload(
      undefined,
      () =>
        new Response(
          JSON.stringify({
            statusCode: '400',
            error: 'Bad Request',
            message: 'mime type video/mp4 is not supported',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await publishViaDialog(user, 'Put Rejection Probe');

    expect(await screen.findByText(/mime type video\/mp4 is not supported/)).toBeInTheDocument();
  });

  it('rejects mismatched drops client-side with a clear message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByText('New Content'));
    await screen.findByText('New Marketing Tool');
    // Bypass the picker's accept filter the way a drag-drop can: set files directly.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bytes'], 'clip.avi', { type: 'video/x-msvideo' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/is not a supported document file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('exposes rows to keyboard users via title links and Enter activation', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<ContentPage />} />
        <Route path="/admin/marketing-tools/:id" element={<div>detail-marker</div>} />
      </Routes>,
      { user: MOCK_ADMIN, route: '/admin' },
    );
    await screen.findByText('JA&D Membership Overview');

    const titleLink = screen.getByRole('link', { name: 'JA&D Membership Overview' });
    expect(titleLink).toHaveAttribute('href', '/admin/marketing-tools/ctn-001');

    const row = titleLink.closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter', bubbles: true });
    expect(await screen.findByText('detail-marker')).toBeInTheDocument();
  });

  it('deletes a marketing tool after confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Delete JA&D Membership Overview' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently remove/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByText('JA&D Membership Overview')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Marketing tool deleted')).toBeInTheDocument();
  });

  it('cancelling the delete confirm keeps the tool', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Delete JA&D Membership Overview' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('JA&D Membership Overview')).toBeInTheDocument();
  });

  it('edits a marketing tool title from the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentPage />, { user: MOCK_ADMIN });
    await screen.findByText('JA&D Membership Overview');

    const [editButton] = screen.getAllByRole('button', { name: 'Edit' });
    await user.click(editButton!);
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByLabelText('Title');
    expect(titleInput).toHaveValue('JA&D Membership Overview');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Overview');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Updated Overview')).toBeInTheDocument();
    expect(await screen.findByText('Marketing tool updated')).toBeInTheDocument();
  });
});
