/**
 * Public OST registration: the sponsor is resolved from the referral code and
 * frozen at submission. The form carries no sponsor field - hidden or
 * otherwise - so the applicant cannot choose or swap sponsors.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { OstRenewalPage } from './OstRenewalPage';

const RESOLUTION = {
  sponsorName: 'Sam Manager',
  codeHint: 'OST-…-3456',
  expiresAt: '2026-10-28T00:00:00.000Z',
};

type RouteHandler = () => { status: number; body: unknown };
const routes = new Map<string, RouteHandler>();

const ok =
  (body: unknown): RouteHandler =>
  () => ({ status: 200, body });

const requests: { path: string; method: string; body: unknown }[] = [];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?')[0]!;
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ path, method, body });
    // Referral resolution is code-addressed, so match the full path.
    const key = `${method} ${url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '')}`;
    const handler = routes.get(key) ?? routes.get(path);
    if (!handler) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${method} ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const { status, body: response } = handler();
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function install(over: Record<string, RouteHandler> = {}) {
  routes.clear();
  routes.set('GET /ost/referrals/OST-ABCDEF-123456', ok(RESOLUTION));
  const reference = (data: unknown[]) => ok({ data, meta: { total: data.length } });
  routes.set('GET /address/public/regions', reference([{ code: '0400000000', name: 'CALABARZON' }]));
  routes.set('GET /address/public/regions/0400000000/provinces', reference([{ code: '0402100000', name: 'Cavite' }]));
  routes.set('GET /address/public/provinces/0402100000/localities', reference([{ code: '0402120000', name: 'Tagaytay', type: 'city', provinceCode: '0402100000', postalCode: '4120' }]));
  routes.set('GET /address/public/localities/0402120000/barangays', reference([{ code: '0402120001', name: 'SYNTHETIC BARANGAY', localityCode: '0402120000' }]));
  routes.set('POST /ost-accreditation/public', () => ({
    status: 201,
    body: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      referenceNumber: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      status: 'submitted',
      submittedAt: '2026-09-28T00:00:00.000Z',
    },
  }));
  for (const [k, v] of Object.entries(over)) routes.set(k, v);
}

const render = (route: string) => renderWithProviders(<App />, { route, sessionUser: null });

beforeEach(() => {
  requests.length = 0;
  install();
  vi.stubGlobal('fetch', mockFetch());
});

it('derives the annual renewal end from the selected start and posts once', async () => {
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  routes.set(
    '/ost/me',
    ok({
      fullName: 'QA OST',
      ostNumber: 'OST-QA',
      status: 'active',
      sponsorName: 'QA SM',
      approvedAt: '2025-01-01',
    }),
  );
  routes.set(
    `/ost-accreditation/members/${id}`,
    ok({
      registration: null,
      currentApplicant: null,
      renewals: [],
      terms: [
        {
          id,
          starts_on: '2025-01-01',
          expires_on: '2026-01-01',
          displayStatus: 'expired',
          approved_at: '2025-01-01',
        },
      ],
    }),
  );
  routes.set('/ost-accreditation/sponsors', ok({ data: [], meta: { total: 0 } }));
  routes.set(`POST /ost-accreditation/members/${id}/renew`, ok({ id }));
  renderWithProviders(<OstRenewalPage />, {
    sessionUser: { authUserId: id, email: 'qa@example.invalid' },
  });
  await screen.findByRole('button', { name: 'Submit renewal for review' });
  fireEvent.change(screen.getByLabelText('Date of renewal'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('Requested start'), { target: { value: '2026-02-01' } });
  const end = screen.getByLabelText('Requested end') as HTMLInputElement;
  expect(end.value).toBe('2027-02-01');
  expect(end.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Submit renewal for review' }));
  await waitFor(() => expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1));
  expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({
    requestedStart: '2026-02-01',
    requestedEnd: '2027-02-01',
  });
});

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Oscar');
  await user.type(screen.getByLabelText('Last name'), 'Trainee');
  await user.type(screen.getByLabelText('Email'), 'oscar@example.invalid');
  await user.type(screen.getByLabelText('Phone'), '+639171234567');
  await user.type(screen.getByLabelText('Date of birth'), '1995-06-15');
  await user.type(screen.getByLabelText('Street address'), '1 Farm Road');
  for (const [label, option] of [['Region', 'CALABARZON'], ['Province', 'Cavite'], ['City / municipality', 'Tagaytay'], ['Barangay', 'SYNTHETIC BARANGAY']]) {
    await user.click(screen.getByRole('combobox', { name: new RegExp(`^${label}`) }));
    await user.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }));
  }
  await user.selectOptions(screen.getByLabelText('Program category'), 'non_vip');
  await user.selectOptions(screen.getByLabelText('Sex'), 'male');
  await user.selectOptions(screen.getByLabelText('Civil status'), 'single');
  await user.selectOptions(screen.getByLabelText('Government ID type'), 'philippine_id');
  await user.type(screen.getByLabelText('Government ID number'), 'SYNTHETIC-ID');
}

describe('public OST registration', () => {
  it('needs a referral code before anything else', async () => {
    render('/ost/register');
    expect(
      await screen.findByText(
        'This page needs a referral code. Ask your Sales Manager for their registration link.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the resolved sponsor read-only with no sponsor field', async () => {
    render('/ost/register?code=OST-ABCDEF-123456');
    expect(await screen.findByText('Sam Manager')).toBeInTheDocument();
    expect(screen.getByText(/This sponsor is fixed and cannot be changed/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/sponsor/i)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/sponsorStaffId/);
  });

  it('blocks submission until the code resolves', async () => {
    install({
      'GET /ost/referrals/OST-ABCDEF-123456': () => ({
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Referral code is not valid' } },
      }),
    });
    render('/ost/register?code=OST-ABCDEF-123456');
    expect(await screen.findByText('Referral code is not valid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeDisabled();
  });

  it('submits the application with the URL code only, never a sponsor id', async () => {
    const user = userEvent.setup();
    render('/ost/register?code=OST-ABCDEF-123456');
    await screen.findByText('Sam Manager');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('Application received')).toBeInTheDocument();
    const post = requests.find(
      (r) => r.method === 'POST' && r.path === '/ost-accreditation/public',
    );
    expect(post?.body).toMatchObject({
      referralCode: 'OST-ABCDEF-123456',
      identity: { firstName: 'Oscar', lastName: 'Trainee', email: 'oscar@example.invalid' },
      form: { programCategory: 'non_vip', governmentIdType: 'philippine_id' },
    });
    expect(post?.body as Record<string, unknown>).not.toHaveProperty('sponsorStaffId');
    expect(post?.body as Record<string, unknown>).not.toHaveProperty('sponsor_staff_id');
  });

  it('surfaces a server refusal without navigating away', async () => {
    install({
      'POST /ost-accreditation/public': () => ({
        status: 409,
        body: { error: { code: 'CONFLICT', message: 'An application is already under review.' } },
      }),
    });
    const user = userEvent.setup();
    render('/ost/register?code=OST-ABCDEF-123456');
    await screen.findByText('Sam Manager');
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('An application is already under review.')).toBeInTheDocument();
  });

  it('renders usable at a narrow mobile width', async () => {
    render('/ost/register?code=OST-ABCDEF-123456');
    await screen.findByText('Sam Manager');
    // Single-column public form: every field labelled, no data table to
    // overflow a 390px viewport.
    for (const label of [
      'First name',
      'Last name',
      'Email',
      'Phone',
      'Date of birth',
      'Street address',
      'City / municipality',
      'Province',
    ]) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeVisible();
    }
    expect(screen.queryByRole('table')).toBeNull();
  });
});
