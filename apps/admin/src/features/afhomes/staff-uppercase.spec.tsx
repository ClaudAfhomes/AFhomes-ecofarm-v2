import userEvent from '@testing-library/user-event';
import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { AfHomesStaffPage } from './AfHomesStaffPage';
import { afHomesRoleSchema } from '@afhomes/contracts';
import { getAfHomesRoles } from './services';

vi.mock('./services', () => ({
  getAfHomesStaff: async () => [],
  getAfHomesRoles: vi.fn(async () => []),
  getAfHomesDepartments: async () => [],
  isTestStaffEmail: () => false,
  createAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
  deactivateAfHomesStaff: vi.fn(),
  deleteAfHomesStaff: vi.fn(),
  purgeTestAfHomesStaff: vi.fn(),
}));

it('excludes Customer from staff provisioning without removing valid staff roles', async () => {
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
  vi.mocked(getAfHomesRoles).mockResolvedValue([
    role,
    { ...role, id: '00000000-0000-4000-8000-000000000002', slug: 'customer', name: 'Customer' },
  ]);
  renderWithProviders(<AfHomesStaffPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'New Staff' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(await dialog.findByRole('option', { name: 'Employee' })).toBeInTheDocument();
  expect(dialog.queryByRole('option', { name: 'Customer' })).not.toBeInTheDocument();
  vi.mocked(getAfHomesRoles).mockResolvedValue([]);
});

it('stores live uppercase in the controlled staff input and rejects digits without touching password', async () => {
  renderWithProviders(<AfHomesStaffPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'New Staff' }));
  const name = screen.getByLabelText('Full name');
  fireEvent.change(name, { target: { value: 'claud mars ' } });
  expect(name).toHaveValue('claud mars ');
  fireEvent.change(name, { target: { value: 'claud123' } });
  expect(screen.getByText(/Use letters, spaces, apostrophes and hyphens only/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create staff' })).toBeDisabled();
  const password = screen.getByLabelText('Temporary password');
  fireEvent.change(password, { target: { value: 'MixedCase!123' } });
  expect(password).toHaveValue('MixedCase!123');
});

it('keeps consecutive mid-name edits at the staff caret', async () => {
  renderWithProviders(<AfHomesStaffPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New Staff' }));
  const input = screen.getByLabelText<HTMLInputElement>('Full name');
  await user.type(input, 'claud mars jimenez');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.value).toBe('clxaud mars jimenez');
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(3);
  await user.keyboard('y');
  expect(input.value).toBe('clxyaud mars jimenez');
  expect(input.selectionStart).toBe(4);
});
