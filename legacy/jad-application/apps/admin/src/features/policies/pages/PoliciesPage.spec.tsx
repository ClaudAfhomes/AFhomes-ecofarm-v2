import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MOCK_ADMIN } from '@jad/mock';

import { resetPolicyStore } from '../../../mock/policyMockStore';
import { installMockApi, renderWithProviders } from '../../../test/utils';
import { PoliciesPage } from './PoliciesPage';

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
    Response.json({ signedUrl: 'https://cdn.test/put', publicUrl: 'https://cdn.test/new.pdf' }),
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

const PDF = () => new File(['%PDF-1.4'], 'terms.pdf', { type: 'application/pdf' });

async function publishViaDialog(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: 'New Policy' }));
  await screen.findByRole('dialog');
  await user.type(screen.getByLabelText('Title'), title);
  await user.selectOptions(screen.getByLabelText('Type'), 'terms');
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(fileInput, PDF());
  await user.click(screen.getByRole('button', { name: 'Publish' }));
}

describe('PoliciesPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetPolicyStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Policies')).toBeInTheDocument();
    expect(screen.getByText(/required PDF/)).toBeInTheDocument();
  });

  it('renders the seeded policy list', async () => {
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
    expect(screen.getByText('Program Guidelines')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.getByText(/Showing 3 of 3 policies/)).toBeInTheDocument();
  });

  it('filters by search text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.type(screen.getByPlaceholderText('Search policies'), 'privacy');
    expect(await screen.findByText('Privacy Policy')).toBeInTheDocument();
    expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search policies'));
    await user.type(screen.getByPlaceholderText('Search policies'), 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('opens New Policy dialog with a required PDF field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.click(screen.getByText('New Policy'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Title')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Type')).toBeInTheDocument();
    expect(within(dialog).getByText('PDF (required)')).toBeInTheDocument();
    const fileInput = document.querySelector(
      'input[type="file"][aria-label="Policy PDF"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.accept).toBe('.pdf');
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('rejects non-PDF drops client-side with a clear message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.click(screen.getByText('New Policy'));
    await screen.findByRole('dialog');

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/must be a PDF file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('publishes a policy with its uploaded PDF', async () => {
    stubStorageUpload();
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await publishViaDialog(user, 'Cookie Policy');

    expect(await screen.findByText('Cookie Policy')).toBeInTheDocument();
    expect(await screen.findByText('Policy published')).toBeInTheDocument();
  });

  it('surfaces the server rejection message when signing fails', async () => {
    stubStorageUpload(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Documents must be PDF, DOC, DOCX, PPT, PPTX, XLS or XLSX',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.click(screen.getByText('New Policy'));
    await screen.findByRole('dialog');
    await user.type(screen.getByLabelText('Title'), 'Rejected Probe');
    await user.selectOptions(screen.getByLabelText('Type'), 'terms');
    // Client accepts .pdf; the server rejects it - bypass with a direct set.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [PDF()], configurable: true });
    fireEvent.change(fileInput);
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText(/Documents must be PDF/)).toBeInTheDocument();
  });

  it('exposes rows to keyboard users via title links and Enter activation', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<PoliciesPage />} />
        <Route path="/admin/policies/:id" element={<div>detail-marker</div>} />
      </Routes>,
      { user: MOCK_ADMIN, route: '/admin' },
    );
    await screen.findByText('Terms and Conditions');

    const titleLink = screen.getByRole('link', { name: 'Terms and Conditions' });
    expect(titleLink).toHaveAttribute('href', '/admin/policies/pol-001');

    const row = titleLink.closest('tr') as HTMLElement;
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter', bubbles: true });
    expect(await screen.findByText('detail-marker')).toBeInTheDocument();
  });

  it('deletes a policy after confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.click(screen.getByRole('button', { name: 'Delete Terms and Conditions' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently remove/)).toBeInTheDocument();
    expect(within(dialog).getByText(/its uploaded PDF/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Terms and Conditions')).not.toBeInTheDocument());
    expect(await screen.findByText('Policy deleted')).toBeInTheDocument();
  });

  it('cancelling the delete confirm keeps the policy', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    await user.click(screen.getByRole('button', { name: 'Delete Terms and Conditions' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Terms and Conditions')).toBeInTheDocument();
  });

  it('edits a policy title from the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PoliciesPage />, { user: MOCK_ADMIN });
    await screen.findByText('Terms and Conditions');

    const [editButton] = screen.getAllByRole('button', { name: 'Edit' });
    await user.click(editButton!);
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByLabelText('Title');
    expect(titleInput).toHaveValue('Terms and Conditions');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Terms');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Updated Terms')).toBeInTheDocument();
    expect(await screen.findByText('Policy updated')).toBeInTheDocument();
  });
});
