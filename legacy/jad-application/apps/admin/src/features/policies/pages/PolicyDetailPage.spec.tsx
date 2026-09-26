import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import Swal from 'sweetalert2';
import { MOCK_ADMIN } from '@jad/mock';

import { resetPolicyStore } from '../../../mock/policyMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { PolicyDetailPage } from './PolicyDetailPage';

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

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/policies" element={<div>list-marker</div>} />
      <Route path="/admin/policies/:id" element={<PolicyDetailPage />} />
    </Routes>,
    { user: MOCK_ADMIN, route: '/admin/policies/pol-001' },
  );
}

/**
 * Layer storage upload over the mock API: the mock server passes
 * `/api/v1/cms/*` through to real fetch, which has no server in tests.
 */
function stubStorageUpload() {
  const mockFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/cms/upload/sign')) {
      return Response.json({
        signedUrl: 'https://cdn.test/put',
        publicUrl: 'https://cdn.test/terms.pdf',
      });
    }
    if (url === 'https://cdn.test/put') return new Response(null, { status: 200 });
    return (mockFetch as typeof fetch)(input, init);
  }) as typeof fetch;
}

describe('PolicyDetailPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetPolicyStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the policy with its summary', async () => {
    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Terms and Conditions' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/abide by the JA&D terms/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to policies' })).toHaveAttribute(
      'href',
      '/admin/policies',
    );
  });

  it('shows the no-PDF state for legacy seed rows', async () => {
    renderDetail();

    expect(await screen.findByText(/No PDF attached yet/)).toBeInTheDocument();
  });

  it('renders a not-found state for an unknown policy id', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin/policies/:id" element={<PolicyDetailPage />} />
      </Routes>,
      { user: MOCK_ADMIN, route: '/admin/policies/pol-999' },
    );

    expect(await screen.findByText('Policy not found')).toBeInTheDocument();
  });

  it('edits the policy from the detail page', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: 'Terms and Conditions' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByLabelText('Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Detail Updated Terms');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    // Success notifications are proper modals (aria-hidden on the page) -
    // assert their copy, then close before role queries on the page.
    expect(await screen.findByText('Policy updated')).toBeInTheDocument();
    Swal.close();
    expect(
      await screen.findByRole('heading', { name: 'Detail Updated Terms' }),
    ).toBeInTheDocument();
  });

  it('deletes the policy from the detail page and returns to the list', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: 'Terms and Conditions' });

    await user.click(screen.getByRole('button', { name: 'Delete Terms and Conditions' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/its uploaded PDF/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('list-marker')).toBeInTheDocument();
    expect(await screen.findByText('Policy deleted')).toBeInTheDocument();
  });

  it('cancelling the delete confirm keeps the policy', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: 'Terms and Conditions' });

    await user.click(screen.getByRole('button', { name: 'Delete Terms and Conditions' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Terms and Conditions' })).toBeInTheDocument();
  });

  it('renders the PDF preview and download link once a PDF is attached', async () => {
    stubStorageUpload();
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('heading', { name: 'Terms and Conditions' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['%PDF-1.4'], 'terms.pdf', { type: 'application/pdf' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Policy updated')).toBeInTheDocument();
    Swal.close();
    await waitFor(() => expect(screen.getByTitle('Terms and Conditions')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://cdn.test/terms.pdf',
    );
  });
});
