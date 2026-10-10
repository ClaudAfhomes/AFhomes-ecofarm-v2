import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ServiceCatalogEditor } from './ServiceCatalogEditor';
import { createService, updateService } from './points-services';
import type { SessionUser } from '../../lib/session';

vi.mock('./points-services', () => ({
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
    await user.type(screen.getByLabelText('Description'), 'Per head dining');
    await user.type(screen.getByLabelText('Base price'), '2000.00');
    await user.click(screen.getByLabelText('Publish on Experiences'));
    await user.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith({
        name: 'Teppanyaki',
        description: 'Per head dining',
        basePrice: '2000.00',
        isActive: true,
        published: true,
        availability: 'available',
        summary: null,
        category: null,
        location: null,
        pricingUnit: 'unit',
        highlights: [],
      }),
    );
    expect(await screen.findByLabelText('Image file')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalled();
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
