import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { resetContentStore } from '../../../mock/contentMockStore';
import { MarketingToolDetailPage } from './MarketingToolDetailPage';

function renderDetail(id: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/marketing-tools/:id" element={<MarketingToolDetailPage />} />
    </Routes>,
    { user: MOCK_ADMIN, route: `/admin/marketing-tools/${id}` },
  );
}

describe('MarketingToolDetailPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetContentStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.unstubAllGlobals();
  });

  /**
   * Layer the signed-upload flow over the mock API (same as ContentPage.spec):
   * sign returns a fresh public URL, the PUT succeeds.
   */
  function stubReplacementUpload(publicUrl: string) {
    const mockFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/cms/upload/sign')) {
        return Response.json({ signedUrl: 'https://cdn.test/replace-put', publicUrl });
      }
      if (url === 'https://cdn.test/replace-put') return new Response(null, { status: 200 });
      return (mockFetch as typeof fetch)(input, init);
    }) as typeof fetch;
  }

  it('renders page header with back link', async () => {
    renderDetail('ctn-001');
    expect(await screen.findByText('Marketing Tool')).toBeInTheDocument();
    expect(screen.getByText('Back to marketing tools')).toBeInTheDocument();
  });

  it('renders item details for a document', async () => {
    renderDetail('ctn-001');
    expect(await screen.findByText('JA&D Membership Overview')).toBeInTheDocument();
    expect(
      screen.getByText('A one-page overview of the JA&D membership opportunity.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Document').length).toBeGreaterThan(0);
  });

  it('shows download link when downloadUrl exists', async () => {
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');
    expect(screen.getByText('Download')).toBeInTheDocument();
  });

  it('shows share links when share object exists', async () => {
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');
    expect(screen.getByText('Share on Messenger')).toBeInTheDocument();
    expect(screen.getByText('Share on Viber')).toBeInTheDocument();
    expect(screen.getByText('Copy Link')).toBeInTheDocument();
  });

  it('renders not found state for unknown id', async () => {
    renderDetail('unknown');
    expect(await screen.findByText('Tool not found')).toBeInTheDocument();
  });

  it('deletes the tool after confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/admin/marketing-tools/:id" element={<MarketingToolDetailPage />} />
        <Route path="/admin/marketing-tools" element={<div>list-marker</div>} />
      </Routes>,
      { user: MOCK_ADMIN, route: '/admin/marketing-tools/ctn-001' },
    );
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Delete JA&D Membership Overview' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently remove/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('list-marker')).toBeInTheDocument();
    expect(await screen.findByText('Marketing tool deleted')).toBeInTheDocument();
  });

  it('edits the tool title from the detail page', async () => {
    const user = userEvent.setup();
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Detail Edited Title');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Detail Edited Title')).toBeInTheDocument();
    expect(await screen.findByText('Marketing tool updated')).toBeInTheDocument();
  });

  it('removes the attached file after marking and saving', async () => {
    const user = userEvent.setup();
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');
    expect(screen.getByText('Download')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove file' }));
    expect(within(dialog).getByText(/marked for removal/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Download')).not.toBeInTheDocument());
    expect(await screen.findByText('Marketing tool updated')).toBeInTheDocument();
  });

  it('undoes a marked removal before saving', async () => {
    const user = userEvent.setup();
    renderDetail('ctn-002');
    await screen.findByText('How Qualifying Sales Work');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove file' }));
    expect(within(dialog).getByText(/marked for removal/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Undo remove' }));
    expect(within(dialog).queryByText(/marked for removal/)).not.toBeInTheDocument();
    // Nothing changed → Save stays disabled.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('previews the newly selected replacement instead of the old image', async () => {
    // Regression: picking a replacement kept showing the previous image.
    const RealURL = globalThis.URL;
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends RealURL {
        static override createObjectURL = () => 'blob:mock-new-image';
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const user = userEvent.setup();
    renderDetail('ctn-003');
    await screen.findByText('JA&D Project Showcase');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img', { name: 'JA&D Project Showcase' })).toBeInTheDocument();

    const fileInput = within(dialog).getByLabelText('Replacement file') as HTMLInputElement;
    await user.upload(fileInput, new File(['new-bytes'], 'new-photo.jpg', { type: 'image/jpeg' }));

    expect(await within(dialog).findByAltText('Preview of new-photo.jpg')).toHaveAttribute(
      'src',
      'blob:mock-new-image',
    );
    expect(
      within(dialog).queryByRole('img', { name: 'JA&D Project Showcase' }),
    ).not.toBeInTheDocument();
  });

  it('exposes a clickable upload dropzone in the edit dialog', async () => {
    // Regression: the file input uses the visually-hidden .fileInput style,
    // so it must sit inside a dropzone <label> to be clickable by mouse.
    const user = userEvent.setup();
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(screen.getByText(/drag a replacement file here/)).toBeInTheDocument();
    const fileInput = within(dialog).getByLabelText('Replacement file');
    expect(fileInput.closest('label')).not.toBeNull();
  });

  it('replaces the file via upload then PATCH', async () => {
    stubReplacementUpload('https://cdn.test/replaced.pdf');
    const user = userEvent.setup();
    renderDetail('ctn-001');
    await screen.findByText('JA&D Membership Overview');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const fileInput = within(dialog).getByLabelText('Replacement file') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['replacement-bytes'], 'replacement.pdf', { type: 'application/pdf' }),
    );
    expect(await within(dialog).findByText(/replacement\.pdf/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Marketing tool updated')).toBeInTheDocument();
    expect(screen.getByText('Download')).toHaveAttribute('href', 'https://cdn.test/replaced.pdf');
  });
});
