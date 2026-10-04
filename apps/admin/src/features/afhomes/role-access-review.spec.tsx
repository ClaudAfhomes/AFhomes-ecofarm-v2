import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { afHomesRoleSchema } from '@jad/contracts';
import { renderWithProviders } from '../../test/utils';
import { AfHomesRolesPage } from './AfHomesRolesPage';
import { getAfHomesRoles, updateAfHomesRole } from './services';
vi.mock('./services', () => ({
  getAfHomesRoles: vi.fn(),
  createAfHomesRole: vi.fn(),
  updateAfHomesRole: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const role = afHomesRoleSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'employee',
  name: 'Employee',
  description: null,
  isSystem: true,
  isActive: true,
  assignedCount: 0,
  permissions: [],
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
});
it('hides Customer and opens protected access read-only without a mutation path', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    role,
    { ...role, id: '00000000-0000-4000-8000-000000000002', slug: 'customer', name: 'Customer' },
  ]);
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'View access' }));
  expect(screen.queryByRole('link', { name: 'Customer' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'View Employee access' })).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
  expect(updateAfHomesRole).not.toHaveBeenCalled();
});
it('keeps the existing custom-role permission editor usable', async () => {
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    { ...role, isSystem: false, slug: 'qa_custom', name: 'QA Custom' },
  ]);
  renderWithProviders(<AfHomesRolesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Name')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled();
});
