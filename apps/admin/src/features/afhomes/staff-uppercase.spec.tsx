import userEvent from '@testing-library/user-event';
import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { AfHomesStaffPage } from './AfHomesStaffPage';

vi.mock('./services', () => ({
  getAfHomesStaff: async () => [],
  getAfHomesRoles: async () => [],
  getAfHomesDepartments: async () => [],
  isTestStaffEmail: () => false,
  createAfHomesStaff: vi.fn(),
  updateAfHomesStaff: vi.fn(),
  deactivateAfHomesStaff: vi.fn(),
  deleteAfHomesStaff: vi.fn(),
  purgeTestAfHomesStaff: vi.fn(),
}));

it('stores live uppercase in the controlled staff input and rejects digits without touching password', async () => {
  renderWithProviders(<AfHomesStaffPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'New Staff' }));
  const name = screen.getByLabelText('Full name');
  fireEvent.change(name, { target: { value: 'claud mars ' } });
  expect(name).toHaveValue('CLAUD MARS ');
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
  expect(input.value).toBe('CLXAUD MARS JIMENEZ');
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(3);
  await user.keyboard('y');
  expect(input.value).toBe('CLXYAUD MARS JIMENEZ');
  expect(input.selectionStart).toBe(4);
});
