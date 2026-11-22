import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ServiceCatalogEditor } from './ServiceCatalogEditor';
import { createEarningRule, createService, updateService } from './points-services';
import type { SessionUser } from '../../lib/session';

vi.mock('./points-services', () => ({
  createEarningRule: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  uploadServicePhoto: vi.fn(),
  manageServicePhoto: vi.fn(),
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  notifySuccess: vi.fn(),
}));
const service = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'AF-SVC-SERVER',
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
const admin: SessionUser = {
  id: 'fixture',
  name: 'Catalog viewer',
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
beforeEach(() => vi.clearAllMocks());
describe('service catalog editing', () => {
  it('creates configured services without asking for a manual product code', async () => {
    vi.mocked(createService).mockResolvedValue(service);
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(
      <ServiceCatalogEditor services={[]} loading={false} error={null} onSaved={onSaved} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.queryByLabelText(/product code/i)).toBeNull();
    await user.type(screen.getByLabelText('Service name'), 'Teppanyaki');
    await user.type(screen.getByLabelText('Description(Optional)'), 'Per head dining');
    await user.type(screen.getByLabelText('Base price'), '2000.00');
    await user.click(screen.getByLabelText('Publish on Experiences'));
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith({
        name: 'Teppanyaki',
        description: 'Per head dining',
        basePrice: '2000.00',
        isActive: true,
        isStaycationEligible: false,
        published: true,
        availability: 'available',
        summary: null,
        category: null,
        location: null,
        pricingUnit: 'unit',
        highlights: [],
      }),
    );
    expect(await screen.findByLabelText('Image file(Optional)')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
  });
  it('marks a staycation service eligible for points spending without a promotion', async () => {
    vi.mocked(createService).mockResolvedValue({ ...service, isStaycationEligible: true });
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Service name'), 'Resort Stay');
    await user.type(screen.getByLabelText('Base price'), '5000.00');
    await user.click(screen.getByLabelText(/staycation or hotel accommodation/i));
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith(
        expect.objectContaining({ isStaycationEligible: true }),
      ),
    );
  });
  it('preserves edited details after a failed save', async () => {
    vi.mocked(updateService).mockRejectedValue(new Error('Save unavailable'));
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[service]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Edit Teppanyaki' }));
    await user.selectOptions(screen.getByLabelText('Availability'), 'unavailable');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('Availability')).toHaveValue('unavailable');
    expect(screen.getByLabelText('Base price')).toHaveValue('2000.00');
  });
  it('accepts a typed peso amount and creates the points rule in the same step', async () => {
    vi.mocked(createService).mockResolvedValue(service);
    vi.mocked(createEarningRule).mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Service name'), 'Teppanyaki');
    await user.type(screen.getByLabelText('Base price'), '₱2,000');
    await user.selectOptions(screen.getByLabelText('Pricing unit'), 'person');
    expect(screen.getByText(/2,000\.00 per person/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Points per person(Optional)'), '200');
    await user.click(screen.getByLabelText('Silver'));
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(createEarningRule).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: service.id,
          pointsAmount: 200,
          eligibleTiers: ['BRONZE', 'GOLD'],
          minQuantity: 1,
          isActive: true,
        }),
      ),
    );
    expect(createService).toHaveBeenCalledWith(
      expect.objectContaining({ basePrice: '2000.00', pricingUnit: 'person' }),
    );
    const rule = vi.mocked(createEarningRule).mock.calls[0]![0];
    expect(rule.effectiveStart < rule.effectiveEnd).toBe(true);
    expect(await screen.findByText(/earn 200 points per person/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps the saved service when the points rule fails, and says so', async () => {
    vi.mocked(createService).mockResolvedValue(service);
    vi.mocked(createEarningRule).mockRejectedValue(new Error('Rule overlaps'));
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Service name'), 'Teppanyaki');
    await user.type(screen.getByLabelText('Base price'), '2000');
    await user.type(screen.getByLabelText('Points per unit(Optional)'), '200');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    expect(
      await screen.findByText(/service was saved, but the points rule was not: Rule overlaps/),
    ).toBeInTheDocument();
  });
  it('shows field errors instead of saving an incomplete service', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Add service' }));
    await user.type(screen.getByLabelText('Base price'), '12abc');
    await user.type(screen.getByLabelText('Points per unit(Optional)'), '1.5');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByText('Enter the service name.')).toBeInTheDocument();
    expect(screen.getByText(/Enter the price in pesos/)).toBeInTheDocument();
    expect(screen.getByText(/whole number of points/)).toBeInTheDocument();
    expect(createService).not.toHaveBeenCalled();
  });
  it('closes the editor after a successful edit', async () => {
    vi.mocked(updateService).mockResolvedValue({ ...service, basePrice: '2500.00' });
    const user = userEvent.setup();
    renderWithProviders(
      <ServiceCatalogEditor services={[service]} loading={false} error={null} onSaved={vi.fn()} />,
      { user: admin },
    );
    await user.click(screen.getByRole('button', { name: 'Edit Teppanyaki' }));
    expect(screen.queryByLabelText(/points per/i)).toBeNull();
    const price = screen.getByLabelText('Base price');
    await user.clear(price);
    await user.type(price, '2500');
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(updateService).toHaveBeenCalledWith(
      service.id,
      expect.objectContaining({ basePrice: '2500.00' }),
    );
  });
  it('gives a view-only GSD the catalog without administration controls', () => {
    renderWithProviders(
      <ServiceCatalogEditor services={[service]} loading={false} error={null} onSaved={vi.fn()} />,
      {
        user: {
          ...admin,
          afHomesPermissions: admin.afHomesPermissions.map((p) => ({
            ...p,
            canCreate: false,
            canUpdate: false,
          })),
        },
      },
    );
    expect(screen.getByText('Teppanyaki')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add service|edit/i })).toBeNull();
  });
});
