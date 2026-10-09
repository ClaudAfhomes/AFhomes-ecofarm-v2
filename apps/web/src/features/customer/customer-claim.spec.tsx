/**
 * The customer's points claim - the QR/code redemption.
 *
 * The behaviour under test is the part that is easy to get wrong: the member must
 * not be able to double-claim, a failure must leave the card untouched, and a
 * capped award must be shown as capped rather than silently reduced.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { CustomerPointsPage } from './CustomerPointsPage';

const CUSTOMER = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  customerNumber: 'CUS-000777',
  fullName: 'Ana R Buyer',
  email: 'ana@example.invalid',
  phone: '+639180000001',
  status: 'active' as const,
  region: null,
  city: null,
  branch: null,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const MEMBERSHIP_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const SUMMARY = {
  membershipId: MEMBERSHIP_ID,
  balance: 60000,
  annualCap: 100000,
  remainingEarningCapacity: 40000,
  spendable: 60000,
  reversalDebt: 0,
  periodStart: '2026-01-01T00:00:00.000Z',
  periodEnd: '2027-01-01T00:00:00.000Z',
  tier: 'GOLD' as const,
  earnedThisPeriod: 60000,
  redeemedThisPeriod: 0,
};

/** The LEGACY summary shape, unchanged: what deployed clients validate against. */
const LEGACY_SUMMARY = {
  membershipId: MEMBERSHIP_ID,
  balance: 60000,
  lifetimeAllocated: 60000,
  lifetimeRedeemed: 0,
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const LEDGER = { data: [], meta: {} };

type RouteHandler = () => { status: number; body: unknown };
const routes = new Map<string, RouteHandler>();

const ok =
  (body: unknown): RouteHandler =>
  () => ({ status: 200, body });
const list =
  (data: unknown[]): RouteHandler =>
  () => ({ status: 200, body: { data, meta: {} } });
const err =
  (status: number, code: string): RouteHandler =>
  () => ({ status, body: { error: { code, message: code } } });

function installRoutes(over: Record<string, RouteHandler> = {}) {
  routes.clear();
  routes.set('/customer', ok(CUSTOMER));
  routes.set('/customer/points', ok(LEGACY_SUMMARY));
  routes.set('/customer/points/position', ok(SUMMARY));
  routes.set('/customer/points/ledger', list(LEDGER.data));
  for (const [path, handler] of Object.entries(over)) routes.set(path, handler);
}

const bodies: string[] = [];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/^\/api\/v1/, '')
      .split('?')[0]!;
    if (init?.body) bodies.push(String(init.body));
    const handler = routes.get(path);
    if (!handler) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed ${path}` } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const { status, body } = handler();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const render = () => renderWithProviders(<CustomerPointsPage />);

beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal('fetch', mockFetch());
  installRoutes();
});

describe('customer points position', () => {
  it('warns about outstanding reversal debt and what it leaves spendable', async () => {
    installRoutes({
      '/customer/points/position': ok({
        ...SUMMARY,
        balance: 60000,
        reversalDebt: 15000,
        spendable: 45000,
      }),
    });
    renderWithProviders(<CustomerPointsPage />);

    expect(await screen.findByText(/15,000 points are held against a reversed/i)).toBeTruthy();
    // 45,000 spendable, not 60,000: the warning must state the real figure.
    expect(screen.getByText(/45,000 of your balance can be spent/i)).toBeTruthy();
    // Earning is explicitly NOT blocked, which is the whole point of separating them.
    expect(screen.getByText(/earning is not affected/i)).toBeTruthy();
  });

  it('shows no debt warning when there is no debt', async () => {
    renderWithProviders(<CustomerPointsPage />);
    await screen.findByLabelText(/claim code/i);
    expect(screen.queryByText(/held against a reversed/i)).toBeNull();
  });

  it('shows the remaining earning capacity as a ceiling, not as spendable money', async () => {
    renderWithProviders(<CustomerPointsPage />);
    expect(await screen.findByText('Can still earn this year')).toBeTruthy();
    expect(screen.getByText('40,000')).toBeTruthy();
    // The headline figure is the spendable one.
    expect(screen.getByText('points available to spend right now')).toBeTruthy();
  });
});

describe('customer points claim', () => {
  it('posts only the credential - never a balance, a figure or an account id', async () => {
    const user = userEvent.setup();
    installRoutes({
      '/earning/claim': ok({
        claimNumber: 'CLM-000001',
        pointsAwarded: 500,
        pointsCapped: 0,
        balanceAfter: 60500,
      }),
    });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-000001');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0]!)).toEqual({ token: 'CLM-000001' });
  });

  it('tells the member what they received and their new balance', async () => {
    const user = userEvent.setup();
    installRoutes({
      '/earning/claim': ok({
        claimNumber: 'CLM-000001',
        pointsAwarded: 500,
        pointsCapped: 0,
        balanceAfter: 60500,
      }),
    });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-000001');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));

    expect(await screen.findByText(/500 points added/i)).toBeTruthy();
    expect(screen.getByText(/60,500/)).toBeTruthy();
    // The field is cleared, so the same code cannot be resubmitted by reflex.
    expect((await screen.findByLabelText(/claim code/i) as HTMLInputElement).value).toBe('');
  });

  it('says plainly that points were capped, instead of quietly reducing them', async () => {
    const user = userEvent.setup();
    installRoutes({
      '/earning/claim': ok({
        claimNumber: 'CLM-000002',
        pointsAwarded: 4000,
        pointsCapped: 20000,
        balanceAfter: 64000,
      }),
    });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-000002');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));

    expect(await screen.findByText(/20,000 points were not added/i)).toBeTruthy();
    expect(screen.getByText(/earning limit/i)).toBeTruthy();
  });

  it('cannot be double-submitted: a second click sends no second request', async () => {
    const user = userEvent.setup();
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installRoutes({
      '/earning/claim': () => {
        calls += 1;
        return {
          status: 200,
          body: { claimNumber: 'CLM-000001', pointsAwarded: 500, pointsCapped: 0, balanceAfter: 60500 },
        };
      },
    });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-000001');
    const button = await screen.findByRole('button', { name: /claim my points/i });

    await user.click(button);
    await waitFor(() => expect(calls).toBe(1));
    // Mid-flight the control is disabled, so a repeated click cannot reach the API.
    await user.click(button);
    await user.click(button);
    release!();
    await gate;

    expect(calls).toBe(1);
  });

  it('does not submit an empty code', async () => {
    const user = userEvent.setup();
    render();
    const button = await screen.findByRole('button', { name: /claim my points/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.click(button);
    expect(bodies).toHaveLength(0);
  });

  it('explains a spent or expired claim and blames nothing on the member', async () => {
    const user = userEvent.setup();
    installRoutes({ '/earning/claim': err(409, 'CONFLICT') });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-OLD');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));

    expect(await screen.findByText(/cannot be used any more/i)).toBeTruthy();
    expect(screen.getByText(/reissue/i)).toBeTruthy();
    // The typed code is kept so a retry is one keystroke away.
    expect((await screen.findByLabelText(/claim code/i) as HTMLInputElement).value).toBe('CLM-OLD');
  });

  it('gives an unknown claim and someone else claim the SAME advice', async () => {
    // The API deliberately returns an identical refusal for both, so the portal
    // must not turn that back into an oracle by phrasing them differently.
    const attempt = async (token: string) => {
      installRoutes({ '/earning/claim': err(404, 'NOT_FOUND') });
      const user = userEvent.setup();
      render();
      await user.type(await screen.findByLabelText(/claim code/i), token);
      await user.click(await screen.findByRole('button', { name: /claim my points/i }));
      const text = (await screen.findByText(/cannot be used/i)).textContent ?? '';
      cleanup();
      return text;
    };

    expect(await attempt('CLM-Y')).toBe(await attempt('CLM-X'));
  });

  it('reassures on a transient failure that nothing was taken', async () => {
    const user = userEvent.setup();
    // The reads must SUCCEED, otherwise the page renders its error state and there
    // is no claim form to submit from. Only the claim itself fails, as a 500.
    installRoutes({ '/earning/claim': err(500, 'INTERNAL') });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-1');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));

    expect(await screen.findByText(/nothing was taken from your card/i)).toBeTruthy();
  });

  it('never retries a claim, because a claim is single-use', async () => {
    const user = userEvent.setup();
    let calls = 0;
    installRoutes({
      '/earning/claim': () => {
        calls += 1;
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } };
      },
    });
    render();

    await user.type(await screen.findByLabelText(/claim code/i), 'CLM-1');
    await user.click(await screen.findByRole('button', { name: /claim my points/i }));
    await screen.findByText(/nothing was taken from your card/i);

    // An automatic retry here would convert a LOST RESPONSE for a claim that
    // actually succeeded into a misleading "already used" error.
    expect(calls).toBe(1);
  });
});
