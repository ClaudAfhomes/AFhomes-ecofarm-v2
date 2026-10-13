/**
 * Points spending promotions: what makes a NON-staycation service discountable.
 *
 * A promotion names ONE service, carries BOTH dates, a reviewable reference and
 * a configured conversion rate. The properties under test are the ones that
 * keep a promotion honest: no indefinite window, no missing reference, no
 * missing rate, and a visible active/inactive state with an explicit
 * confirmation - because a promotion changes what members may spend points on.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import { PointsRulesPage } from './PointsRulesPage';
import {
  createRedemptionRule,
  listRedemptionRules,
  listServices,
  updateRedemptionRule,
  manageServicePolicy,
} from './points-services';
import type { SessionUser } from '../../lib/session';

const { notifyConfirm } = vi.hoisted(() => ({ notifyConfirm: vi.fn(async () => true) }));

vi.mock('./points-services', () => ({
  manageServicePolicy: vi.fn(async () => ({ isActive: false })),
  createEarningRule: vi.fn(),
  setServicePolicyActive: vi.fn(),
  listEarningRules: vi.fn(async () => []),
  listTierDiscounts: vi.fn(async () => []),
  createTierDiscount: vi.fn(),
  listServices: vi.fn(),
  listRedemptionRules: vi.fn(),
  createRedemptionRule: vi.fn(),
  updateRedemptionRule: vi.fn(),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifySuccess: vi.fn(),
  notifyConfirm,
}));
vi.mock('./ServiceCatalogEditor', () => ({ ServiceCatalogEditor: () => null }));

const SERVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SERVICE = {
  id: SERVICE_ID,
  code: 'AF-SVC-TEP',
  name: 'Teppanyaki',
  description: 'Per head dining',
  basePrice: '2000.00',
  isActive: true,
  isStaycationEligible: false,
  published: false,
  availability: 'available' as const,
  photos: [],
  summary: null,
  category: null,
  location: null,
  pricingUnit: 'person' as const,
  highlights: [],
};

const PROMOTION: {
  id: string;
  serviceId: string;
  ruleKind: 'promotion' | 'accommodation';
  pesoValuePerPoint: string;
  eligibleTiers: ('BRONZE' | 'SILVER' | 'GOLD')[];
  minPoints: number;
  maxPoints: number | null;
  minPurchaseAmount: string | null;
  effectiveStart: string;
  effectiveEnd: string;
  isActive: boolean;
  promotionReference: string;
  allowDiscountStacking: boolean;
} = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  serviceId: SERVICE_ID,
  ruleKind: 'promotion',
  pesoValuePerPoint: '1',
  eligibleTiers: ['GOLD'],
  minPoints: 1,
  maxPoints: null,
  minPurchaseAmount: null,
  effectiveStart: '2026-01-01',
  effectiveEnd: '2027-01-01',
  isActive: true,
  promotionReference: 'TEP-2026',
  allowDiscountStacking: false,
};

const admin: SessionUser = {
  id: 'fixture',
  name: 'Catalog admin',
  email: 'fixture@example.invalid',
  roleId: 'fixture',
  roleName: 'Fixture',
  status: 'active',
  afHomesPermissions: [
    {
      moduleKey: 'operations.catalog',
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  notifyConfirm.mockResolvedValue(true);
  vi.mocked(listServices).mockResolvedValue([SERVICE]);
  vi.mocked(listRedemptionRules).mockResolvedValue([PROMOTION]);
});

describe('spending promotions', () => {
  it('lists the configured rate, tiers, window and reference', async () => {
    renderWithProviders(<PointsRulesPage />, { user: admin });
    expect(await screen.findByText('TEP-2026')).toBeInTheDocument();
    expect(screen.getByText('₱1.00 / point')).toBeInTheDocument();
  });

  it('refuses to save without both dates and a reviewable reference', async () => {
    renderWithProviders(<PointsRulesPage />, { user: admin });
    await screen.findByText('TEP-2026');
    // The button stays disabled until the mandatory fields are present: an
    // indefinite or unnamed promotion must be unexpressible, not merely
    // server-refused.
    expect(screen.getByRole('button', { name: 'Add promotion' })).toBeDisabled();
    expect(createRedemptionRule).not.toHaveBeenCalled();
  });

  it('leaves stacking off unless explicitly permitted', async () => {
    vi.mocked(createRedemptionRule).mockResolvedValue(PROMOTION);
    const user = userEvent.setup();
    renderWithProviders(<PointsRulesPage />, { user: admin });
    await screen.findByText('TEP-2026');
    await user.selectOptions(
      screen.getByLabelText('Service', { selector: '#promo-service' }),
      SERVICE_ID,
    );
    fireEvent.change(screen.getByLabelText(/effective from/i, { selector: '#promo-start' }), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByLabelText(/effective to/i, { selector: '#promo-end' }), {
      target: { value: '2026-03-01' },
    });
    await user.type(screen.getByLabelText(/pesos per point/i), '0.5');
    await user.type(screen.getByLabelText(/promotion reference/i), 'TEP-VALENTINES-2026');
    // The stacking box starts unchecked: combining discounts is opt-in, and the
    // payload must say false rather than omitting the decision.
    await user.click(screen.getByRole('button', { name: 'Add promotion' }));
    await waitFor(() =>
      expect(createRedemptionRule).toHaveBeenCalledWith(
        expect.objectContaining({ allowDiscountStacking: false }),
      ),
    );
  });

  it('permits stacking only through an explicit opt-in', async () => {
    vi.mocked(createRedemptionRule).mockResolvedValue({
      ...PROMOTION,
      allowDiscountStacking: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<PointsRulesPage />, { user: admin });
    await screen.findByText('TEP-2026');
    await user.selectOptions(
      screen.getByLabelText('Service', { selector: '#promo-service' }),
      SERVICE_ID,
    );
    fireEvent.change(screen.getByLabelText(/effective from/i, { selector: '#promo-start' }), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByLabelText(/effective to/i, { selector: '#promo-end' }), {
      target: { value: '2026-03-01' },
    });
    await user.type(screen.getByLabelText(/pesos per point/i), '0.5');
    await user.type(screen.getByLabelText(/promotion reference/i), 'TEP-STACK-2026');
    await user.click(screen.getByLabelText(/permit combining/i));
    await user.click(screen.getByRole('button', { name: 'Add promotion' }));
    await waitFor(() =>
      expect(createRedemptionRule).toHaveBeenCalledWith(
        expect.objectContaining({ allowDiscountStacking: true }),
      ),
    );
  });

  it('deactivates a promotion only after an explicit confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PointsRulesPage />, { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(notifyConfirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(updateRedemptionRule).toHaveBeenCalledWith(PROMOTION.id, { isActive: false }),
    );
  });

  it('shows an empty state that names the staycation default, not a blank page', async () => {
    vi.mocked(listRedemptionRules).mockResolvedValue([]);
    renderWithProviders(<PointsRulesPage />, { user: admin });
    expect(await screen.findByText('No spending promotions')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Staycation purchases work without one. Add a promotion to open another service to points spending.',
      ),
    ).toBeInTheDocument();
  });
});

it('keeps only failed services selected when a multi-service promotion save is retried', async () => {
  const secondId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  vi.mocked(listServices).mockResolvedValue([SERVICE, { ...SERVICE, id: secondId, name: 'Hotel' }]);
  vi.mocked(createRedemptionRule)
    .mockResolvedValueOnce(PROMOTION)
    .mockRejectedValueOnce(new Error('Second service unavailable'))
    .mockResolvedValueOnce(PROMOTION);
  const user = userEvent.setup();
  renderWithProviders(<PointsRulesPage />, { user: admin });
  await screen.findByText('TEP-2026');
  await user.selectOptions(screen.getByLabelText('Service', { selector: '#promo-service' }), [
    SERVICE_ID,
    secondId,
  ]);
  fireEvent.change(screen.getByLabelText(/effective from/i, { selector: '#promo-start' }), {
    target: { value: '2026-02-01' },
  });
  fireEvent.change(screen.getByLabelText(/effective to/i, { selector: '#promo-end' }), {
    target: { value: '2026-03-01' },
  });
  await user.type(screen.getByLabelText(/pesos per point/i), '0.5001');
  await user.type(screen.getByLabelText(/promotion reference/i), 'MULTI-2026');
  await user.click(screen.getByRole('button', { name: 'Add promotion' }));
  await screen.findByText('Second service unavailable');
  expect(createRedemptionRule).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('button', { name: 'Add promotion' }));
  await waitFor(() => expect(createRedemptionRule).toHaveBeenCalledTimes(3));
  expect(createRedemptionRule).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({ serviceId: secondId, pesoValuePerPoint: '0.5001' }),
  );
  expect(notifyConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ confirmButtonText: 'Save rules' }),
  );
});

import { createTierDiscount, createEarningRule } from './points-services';

it.each(['tier', 'rule'] as const)(
  'saves a separate %s rule for each selected service',
  async (kind) => {
    const secondId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    vi.mocked(listServices).mockResolvedValue([
      SERVICE,
      { ...SERVICE, id: secondId, name: 'Hotel' },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<PointsRulesPage />, { user: admin });
    await screen.findByText('TEP-2026');
    await user.selectOptions(screen.getByLabelText('Service', { selector: `#${kind}-service` }), [
      SERVICE_ID,
      secondId,
    ]);
    fireEvent.change(document.getElementById(`${kind}-start`)!, {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(document.getElementById(`${kind}-end`)!, { target: { value: '2026-03-01' } });
    if (kind === 'rule') await user.type(screen.getByLabelText('Points per service unit'), '100');
    await user.click(
      screen.getByRole('button', { name: kind === 'tier' ? 'Add tier discount' : 'Add rule' }),
    );
    const create = kind === 'tier' ? createTierDiscount : createEarningRule;
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ serviceId: SERVICE_ID }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ serviceId: secondId }));
  },
);

it('permanently removes a promotion through the delete endpoint when permitted', async () => {
  const user = userEvent.setup();
  renderWithProviders(<PointsRulesPage />, {
    user: {
      ...admin,
      afHomesPermissions: admin.afHomesPermissions?.map((p) => ({ ...p, canDelete: true })),
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(manageServicePolicy).toHaveBeenCalledWith('redemption-rules', PROMOTION.id, undefined),
  );
  expect(updateRedemptionRule).not.toHaveBeenCalled();
});
it('edits the existing promotion instead of creating a duplicate', async () => {
  const user = userEvent.setup();
  renderWithProviders(<PointsRulesPage />, { user: admin });
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('peso value per point'), { target: { value: '0.5001' } });
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(manageServicePolicy).toHaveBeenCalledWith(
      'redemption-rules',
      PROMOTION.id,
      expect.objectContaining({ peso_value_per_point: '0.5001' }),
    ),
  );
  expect(createRedemptionRule).not.toHaveBeenCalled();
});
