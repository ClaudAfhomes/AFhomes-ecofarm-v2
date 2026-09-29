/**
 * AF Homes Phase 27 document UI.
 *
 * Proves the ID Documents screens render real backend state (never mocks):
 * intake with client-side validation, list loading/empty/error handling, OCR
 * processing and failure states with a manual-entry fallback, an editable
 * working copy that is explicit about sending nulls for cleared fields, and a
 * signed-URL preview that never constructs a public bucket URL.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import type { SessionUser } from '../../lib/session';

type Route = { status?: number; body: unknown };
const routes = new Map<string, Route>();
const requests: { path: string; method: string; body: unknown; query: string }[] = [];

const list = (data: unknown[]): Route => ({ status: 200, body: { data, meta: { total: data.length } } });

const DOC_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUBJECT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const doc = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  subjectType: 'customer',
  subjectId: SUBJECT_ID,
  originalFilename: 'id-front.jpg',
  mime: 'image/jpeg',
  sizeBytes: 11,
  hasFile: true,
  ocrStatus: 'failed',
  ocrProvider: 'http',
  verificationStatus: 'pending_review',
  extractedFields: {},
  warnings: ['OCR_NO_TEXT_DETECTED'],
  reviewedFields: null,
  possibleDuplicate: null,
  uploadedAt: '2026-09-27T10:00:00.000Z',
  reviewedAt: null,
  ...over,
});

const DOCS_USER: SessionUser = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Doc Reviewer',
  email: 'docs@afhomes.test',
  roleId: 'r-docs',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [
    { moduleKey: 'dashboard.view', canView: true, canCreate: false, canUpdate: false, canDelete: false },
    { moduleKey: 'sales.id_documents', canView: true, canCreate: false, canUpdate: false, canDelete: false },
  ],
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const [bare, query = ''] = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?');
    const path = bare!;
    const method = init?.method ?? 'GET';
    // Raw byte PUTs to signed upload URLs carry no JSON body and no session.
    if (method === 'PUT') {
      requests.push({ path, method, body: null, query });
      return new Response(null, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ path, method, body, query });
    const route = routes.get(`${method} ${path}`) ?? routes.get(path);
    if (!route) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${method} ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function install(over: Record<string, Route> = {}) {
  routes.clear();
  routes.set('GET /documents', list([]));
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string, user: SessionUser = DOCS_USER) =>
  renderWithProviders(<App />, { route, user });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

/* ================================================================== */
/* List states: loading / empty / error (35/36/37)                     */
/* ================================================================== */

describe('Phase 27 documents list states', () => {
  it('35. shows a loading state while the list is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render('/admin/documents');
    expect(await screen.findByText('Loading documents…')).toBeInTheDocument();
  });

  it('36. shows an empty state when no document exists', async () => {
    install({ 'GET /documents': list([]) });
    render('/admin/documents');
    expect(await screen.findByText('No documents')).toBeInTheDocument();
  });

  it('37. shows an error with retry and recovers', async () => {
    const user = userEvent.setup();
    install({
      'GET /documents': { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } },
    });
    render('/admin/documents');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    install({ 'GET /documents': list([doc()]) });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('id-front.jpg')).toBeInTheDocument();
  });

  it('renders server document statuses, never invented ones', async () => {
    install({ 'GET /documents': list([doc()]) });
    render('/admin/documents');
    await screen.findByText('id-front.jpg');
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('pending review')).toBeInTheDocument();
  });
});

/* ================================================================== */
/* Upload validation and success                                       */
/* ================================================================== */

describe('Phase 27 upload flow', () => {
  it('rejects an unsupported file type before any network call', async () => {
    const user = userEvent.setup();
    render('/admin/documents');
    await screen.findByText('No documents');
    const file = new File(['evil'], 'evil.exe', { type: 'application/x-msdownload' });
    // fireEvent bypasses the input's accept hint, proving the component's own
    // allowlist rejects the file even when the browser hint is circumvented.
    fireEvent.change(screen.getByLabelText(/Scan to upload/), { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload scan' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Upload scan' }));
    expect(await screen.findByText('Only JPEG, PNG or PDF files are accepted.')).toBeInTheDocument();
    expect(requests.filter((r) => r.path.includes('upload-url'))).toHaveLength(0);
  });

  it('rejects an oversized file before any network call', async () => {
    const user = userEvent.setup();
    render('/admin/documents');
    await screen.findByText('No documents');
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([bytes], 'huge.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Scan to upload/), file);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload scan' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Upload scan' }));
    expect(
      await screen.findByText('The file must be non-empty and at most 10 MiB.'),
    ).toBeInTheDocument();
    expect(requests.filter((r) => r.path.includes('upload-url'))).toHaveLength(0);
  });

  it('uploads through a server grant and links to review, finalizing nothing', async () => {
    const user = userEvent.setup();
    install({
      'GET /documents': list([]),
      'POST /documents/customer/upload-url': {
        status: 201,
        body: {
          documentId: DOC_ID,
          bucket: 'afhomes-customer-ids',
          uploadUrl: 'https://storage.test/upload/afhomes-customer-ids/customer/x.jpg',
          expiresAt: '2026-10-01T00:10:00.000Z',
        },
      },
    });
    render('/admin/documents');
    await screen.findByText('No documents');
    await user.type(screen.getByLabelText('Customer ID'), SUBJECT_ID);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'id.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Scan to upload/), file);
    await user.click(screen.getByRole('button', { name: 'Upload scan' }));
    expect(await screen.findByText(/nothing is final until a human confirms it/i)).toBeInTheDocument();
    // The bytes went to the signed URL only; no profile or review call fired.
    expect(requests.some((r) => r.method === 'PUT')).toBe(true);
    expect(requests.filter((r) => r.path.endsWith('/confirm'))).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\/object\/public\//);
  });
});

/* ================================================================== */
/* Review: OCR states, manual fallback, edit/clear, preview (38/39)    */
/* ================================================================== */

describe('Phase 27 document review', () => {
  it('38. shows an extracting state while OCR runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if ((init?.method ?? 'GET') === 'POST' && url.includes('/ocr')) {
          requests.push({ path: '/ocr', method: 'POST', body: null, query: '' });
          return new Promise(() => {}) as unknown as Response;
        }
        return (mockFetch() as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>)(input, init);
      }),
    );
    install({
      'GET /documents/aaaaaaaa-0000-4000-8000-000000000001': {
        status: 200,
        body: doc({ ocrStatus: 'not_requested', ocrProvider: null, warnings: [] }),
      },
      'GET /documents/aaaaaaaa-0000-4000-8000-000000000001/access-url': {
        status: 200,
        body: { url: 'https://storage.test/download/x?ttl=60', expiresAt: '2026-10-01T00:01:00.000Z' },
      },
    });
    const user = userEvent.setup();
    render(`/admin/documents/${DOC_ID}`);
    await screen.findByText('OCR suggestions (not authoritative)');
    await user.click(screen.getByRole('button', { name: 'Re-run extraction' }));
    expect(await screen.findByRole('button', { name: 'Extracting…' })).toBeDisabled();
  });

  it('39. offers manual entry when OCR extracted nothing', async () => {
    const user = userEvent.setup();
    install({
      [`GET /documents/${DOC_ID}`]: { status: 200, body: doc() },
      [`GET /documents/${DOC_ID}/access-url`]: {
        status: 200,
        body: { url: 'https://storage.test/download/x?ttl=60', expiresAt: '2026-10-01T00:01:00.000Z' },
      },
      [`POST /documents/${DOC_ID}/confirm`]: {
        status: 200,
        body: doc({
          verificationStatus: 'confirmed',
          reviewedFields: { firstName: 'Manual Ana' },
          reviewedAt: '2026-09-28T10:00:00.000Z',
        }),
      },
    });
    render(`/admin/documents/${DOC_ID}`);
    expect(await screen.findByText('No fields were extracted. Enter the values manually below.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and edit' }));
    await user.type(screen.getByLabelText('Add a field'), 'firstName');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.type(screen.getByLabelText(/firstName \(editable copy/), 'Manual Ana');
    await user.click(screen.getByRole('button', { name: 'Confirm reviewed values' }));
    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.path === `/documents/${DOC_ID}/confirm`);
      expect(post?.body).toMatchObject({ decision: 'confirmed', fields: { firstName: 'Manual Ana' } });
    });
    expect(await screen.findByText('Confirmed.')).toBeInTheDocument();
  });

  it('edits a suggestion and clears another to null', async () => {
    const user = userEvent.setup();
    const suggested = doc({
      ocrStatus: 'completed',
      ocrProvider: 'http',
      warnings: [],
      extractedFields: {
        firstName: { value: 'Ana', confidence: 0.95 },
        idNumber: { value: '****4567', confidence: 0.2 },
      },
    });
    install({
      [`GET /documents/${DOC_ID}`]: { status: 200, body: suggested },
      [`GET /documents/${DOC_ID}/access-url`]: {
        status: 200,
        body: { url: 'https://storage.test/download/x?ttl=60', expiresAt: '2026-10-01T00:01:00.000Z' },
      },
      [`POST /documents/${DOC_ID}/confirm`]: {
        status: 200,
        body: doc({ verificationStatus: 'confirmed', reviewedFields: { firstName: 'Ana-Marie' } }),
      },
    });
    render(`/admin/documents/${DOC_ID}`);
    // Low confidence is surfaced informationally, never auto-approved.
    expect(await screen.findByText('low (0.20)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and edit' }));
    await user.clear(screen.getByLabelText(/firstName \(editable copy/));
    await user.type(screen.getByLabelText(/firstName \(editable copy/), 'Ana-Marie');
    // Clearing sends null: the reviewer explicitly removed the value.
    await user.clear(screen.getByLabelText(/idNumber \(editable copy/));
    await user.click(screen.getByRole('button', { name: 'Confirm reviewed values' }));
    await waitFor(() => {
      const post = requests.find((r) => r.method === 'POST' && r.path === `/documents/${DOC_ID}/confirm`);
      expect(post?.body).toMatchObject({ fields: { firstName: 'Ana-Marie', idNumber: null } });
    });
  });

  it('40. previews through the signed URL and never builds a public one', async () => {
    install({
      [`GET /documents/${DOC_ID}`]: { status: 200, body: doc() },
      [`GET /documents/${DOC_ID}/access-url`]: {
        status: 200,
        body: { url: 'https://storage.test/download/afhomes-customer-ids/x?ttl=60', expiresAt: '2026-10-01T00:01:00.000Z' },
      },
    });
    render(`/admin/documents/${DOC_ID}`);
    const img = (await screen.findByAltText('Scan of id-front.jpg')) as HTMLImageElement;
    expect(img.src).toContain('https://storage.test/download/afhomes-customer-ids/x?ttl=60');
    expect(document.body.textContent).not.toMatch(/\/object\/public\//);
  });

  it('keeps metadata usable when the preview grant fails', async () => {
    install({
      [`GET /documents/${DOC_ID}`]: { status: 200, body: doc() },
      [`GET /documents/${DOC_ID}/access-url`]: {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'boom' } },
      },
    });
    render(`/admin/documents/${DOC_ID}`);
    expect(await screen.findByText('The preview is unavailable right now. The metadata below is unaffected.')).toBeInTheDocument();
    expect(screen.getByText('OCR suggestions (not authoritative)')).toBeInTheDocument();
  });
});
