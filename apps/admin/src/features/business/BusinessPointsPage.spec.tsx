/**
 * Earn Points: the identify step.
 *
 * The property under test is that scanning a card and typing its code are the SAME
 * operation. Scanning is only ever a faster way to type; if the two paths could
 * disagree, the camera would become a way to bypass whatever the keyboard path
 * checks.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { BusinessPointsPage } from './BusinessPointsPage';
import {
  listServices,
  resolveMemberIdentifier,
} from './points-services';

vi.mock('./points-services', async () => ({
  listServices: vi.fn(),
  resolveMemberIdentifier: vi.fn(),
  recordPurchase: vi.fn(),
  completePurchase: vi.fn(),
  issueEarningClaim: vi.fn(),
  reissueEarningClaim: vi.fn(),
  adjustPoints: vi.fn(),
  reversePurchasePoints: vi.fn(),
  createService: vi.fn(),
  listEarningRules: vi.fn(),
  createEarningRule: vi.fn(),
}));

const resolved = vi.mocked(resolveMemberIdentifier);
const services = vi.mocked(listServices);

const RESOLVED = {
  membershipId: 'bbbbbbbb-0000-4000-8000-000000000001',
  membershipNumber: 'MBS-000777',
  customerDisplayName: 'Ana R Buyer',
  productName: 'Gold',
  membershipStatus: 'active',
  expired: false,
  redeemable: true,
  blockedReason: null,
  pointsBalance: 60000,
  matchedBy: 'qr' as const,
};

const SERVICES = [
  {
    id: 'cccccccc-0000-4000-8000-000000000001',
    code: 'SVC-1',
    name: 'Wash',
    description: null,
    basePrice: '2500.00',
    isActive: true,
  },
];

const render = () => renderWithProviders(<BusinessPointsPage />);

beforeEach(() => {
  vi.clearAllMocks();
  services.mockResolvedValue(SERVICES as never);
  resolved.mockResolvedValue(RESOLVED as never);
  // jsdom has no camera. The scanner reports that and points staff at the typed
  // field, which is exactly the fallback the real screen offers.
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
});

describe('earn points: identify', () => {
  it('does not identify anyone on its own', async () => {
    render();
    await screen.findByRole('button', { name: /scan the member/i });
    expect(resolved).not.toHaveBeenCalled();
  });

  it('resolves a typed member code and names the member back', async () => {
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText(/member code/i), 'MBS-000777');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    expect(await screen.findByText('Ana R Buyer')).toBeTruthy();
    expect(screen.getByText('MBS-000777')).toBeTruthy();
    expect(screen.getByText('60,000')).toBeTruthy();
    expect(resolved).toHaveBeenCalledWith('MBS-000777');
  });

  it('sends the scanned credential to the SHARED resolver, not a private one', async () => {
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText(/member code/i), 'QR-PAYLOAD');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    await screen.findByText('Ana R Buyer');
    // The scanner and the keyboard field call the SAME function, which is the one
    // wrapping /redemptions/resolve. identifier.ts is the only place a code
    // becomes a membership; a second resolver could drift from it and accept a
    // rotated-out credential.
    expect(resolved).toHaveBeenCalledWith('QR-PAYLOAD');
  });

  it('clears the typed code once the member is found', async () => {
    const user = userEvent.setup();
    render();

    const field = await screen.findByLabelText(/member code/i);
    await user.type(field, 'MBS-000777');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    await screen.findByText('Ana R Buyer');
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('says nothing useful about an unknown card', async () => {
    const user = userEvent.setup();
    resolved.mockRejectedValue(new Error('No membership matches that identifier'));
    render();

    await user.type(await screen.findByLabelText(/member code/i), 'MBS-000000');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    // Asserted on the message, not the title: both contain "not recognised", and
    // matching both would make the assertion ambiguous.
    expect(await screen.findByText(/check the code and try again/i)).toBeTruthy();
    expect(screen.queryByText('Ana R Buyer')).toBeNull();
  });

  it('will not resolve an empty code', async () => {
    const user = userEvent.setup();
    render();
    const button = await screen.findByRole('button', { name: /find member/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(resolved).not.toHaveBeenCalled();
  });

  it('offers the typed fallback when there is no camera', async () => {
    render();
    expect(await screen.findByRole('button', { name: /scan the member/i })).toBeTruthy();
    // Always present, camera or not, so a till with no camera is never blocked.
    expect(await screen.findByLabelText(/member code/i)).toBeTruthy();
  });

  it('blocks an expired card instead of inviting a purchase', async () => {
    const user = userEvent.setup();
    resolved.mockResolvedValue({ ...RESOLVED, expired: true, redeemable: false } as never);
    render();

    await user.type(await screen.findByLabelText(/member code/i), 'MBS-OLD');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    expect(await screen.findByText(/has expired/i)).toBeTruthy();
    // The server refuses this regardless, but the screen must not invite it.
    await waitFor(() => expect(screen.queryByLabelText(/^service$/i)).toBeNull());
  });

  it('does not offer the purchase step until a member is identified', async () => {
    render();
    await screen.findByRole('button', { name: /scan the member/i });
    expect(screen.queryByLabelText(/^service$/i)).toBeNull();
  });

  it('opens the purchase step once a member is identified', async () => {
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText(/member code/i), 'MBS-000777');
    await user.click(screen.getByRole('button', { name: /find member/i }));

    expect(await screen.findByLabelText(/^service$/i)).toBeTruthy();
    // Not yet: a service must be chosen before anything can be recorded.
    expect((await screen.findByRole('button', { name: /record, settle/i })).hasAttribute('disabled')).toBe(
      true,
    );
  });
});