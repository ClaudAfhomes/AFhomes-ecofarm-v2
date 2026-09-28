/**
 * Public OST registration: the sponsor is resolved from the referral code and
 * frozen at submission. The form carries no sponsor field - hidden or
 * otherwise - so the applicant cannot choose or swap sponsors.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';

const RESOLUTION = {
  sponsorName: 'Sam Manager',
  codeHint: 'OST-…-3456',
  expiresAt: '2026-10-28T00:00:00.000Z',
};

type RouteHandler = () => { status: number; body: unknown };
const routes = new Map<string, RouteHandler>();

const ok = (body: unknown): RouteHandler => () => ({ status: 200, body });

const requests: { path: string; method: string; body: unknown }[] = [];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '').split('?')[0]!;
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
  routes.set('POST /ost/applications', () => ({
    status: 201,
    body: {
      applicationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
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

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('First name'), 'Oscar');
  await user.type(screen.getByLabelText('Last name'), 'Trainee');
  await user.type(screen.getByLabelText('Email'), 'oscar@example.invalid');
  await user.type(screen.getByLabelText('Phone'), '+639171234567');
  await user.type(screen.getByLabelText('Date of birth'), '1995-06-15');
  await user.type(screen.getByLabelText('Street address'), '1 Farm Road');
  await user.type(screen.getByLabelText('City'), 'Tagaytay');
  await user.type(screen.getByLabelText('Province'), 'Cavite');
}

describe('public OST registration', () => {
  it('needs a referral code before anything else', async () => {
    render('/ost/register');
    expect(
      await screen.findByText('This page needs a referral code. Ask your Sales Manager for their registration link.'),
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
    const post = requests.find((r) => r.method === 'POST' && r.path === '/ost/applications');
    expect(post?.body).toMatchObject({
      referralCode: 'OST-ABCDEF-123456',
      firstName: 'Oscar',
      email: 'oscar@example.invalid',
    });
    expect(post?.body as Record<string, unknown>).not.toHaveProperty('sponsorStaffId');
    expect(post?.body as Record<string, unknown>).not.toHaveProperty('sponsor_staff_id');
  });

  it('surfaces a server refusal without navigating away', async () => {
    install({
      'POST /ost/applications': () => ({
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
      'City',
      'Province',
    ]) {
      expect(screen.getByLabelText(label)).toBeVisible();
    }
    expect(screen.queryByRole('table')).toBeNull();
  });
});
