import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { resetStaffStore } from '../../../mock/staffMockStore';
import { renderWithProviders } from '../../../test/utils';
import { StaffFormDialog } from './StaffFormDialog';

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useCreateStaff', () => ({
  useCreateStaff: () => ({ mutateAsync, isPending: false }),
}));

const rolesData = vi.hoisted(() => ({
  current: [
    { id: 'super_admin', name: 'Super Admin', permissions: ['staff'], isSystem: true },
    { id: 'admin', name: 'Admin', permissions: ['sales'], isSystem: true },
    { id: 'finance', name: 'Finance', permissions: ['sales'], isSystem: true },
  ],
}));

const DEFAULT_ROLES = rolesData.current.map((r) => ({ ...r, permissions: [...r.permissions] }));

vi.mock('../../roles/hooks/useRoles', () => ({
  useRoles: () => ({ data: rolesData.current }),
}));

function renderDialog(onClose = vi.fn()) {
  renderWithProviders(<StaffFormDialog open onClose={onClose} />, { user: MOCK_SUPER_ADMIN });
  return { onClose };
}

describe('StaffFormDialog', () => {
  beforeEach(() => {
    resetStaffStore();
    rolesData.current = [...DEFAULT_ROLES];
    mutateAsync.mockReset().mockResolvedValue({ id: 'stf-008', name: 'New Hire' });
  });

  it('renders name, email, and role fields', async () => {
    renderDialog();
    expect(await screen.findByText('Create Staff Member')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByText(/start ACTIVE/i)).toBeInTheDocument();
  });

  it('requires name and email', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText('Create Staff'));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('rejects malformed emails locally and surfaces server duplicates', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Name'), 'New Hire');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Temporary password'), 'TempPass1');
    await user.click(screen.getByText('Create Staff'));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();

    // Uniqueness is enforced server-side (409) - the dialog surfaces it as
    // a submit error instead of checking mock data.
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'ada.admin@jad.example');
    mutateAsync.mockRejectedValueOnce(new Error('A staff member with this email already exists.'));
    await user.click(screen.getByText('Create Staff'));
    expect(
      await screen.findByText('A staff member with this email already exists.'),
    ).toBeInTheDocument();
  });

  it('creates staff with actor attribution and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.type(screen.getByLabelText('Name'), 'New Hire');
    await user.type(screen.getByLabelText('Email'), 'new.hire@jad.example');
    await user.type(screen.getByLabelText('Temporary password'), 'TempPass1');
    await user.selectOptions(screen.getByLabelText('Role'), 'finance');
    await user.click(screen.getByText('Create Staff'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      name: 'New Hire',
      email: 'new.hire@jad.example',
      roleId: 'finance',
      temporaryPassword: 'TempPass1',
      actor: 'Saul Super',
      actorRole: 'SUPER_ADMIN',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('requires a temporary password and submits it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Name'), 'Temp Hire');
    await user.type(screen.getByLabelText('Email'), 'temp.hire@jad.example');
    await user.type(screen.getByLabelText('Temporary password'), 'TempPass1');
    await user.click(screen.getByText('Create Staff'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ temporaryPassword: 'TempPass1' }),
    );
  });

  it('rejects a missing or weak temporary password', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Name'), 'Temp Hire');
    await user.type(screen.getByLabelText('Email'), 'temp.hire@jad.example');
    await user.click(screen.getByText('Create Staff'));
    expect(await screen.findByText(/temporary password.*required|at least 8/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('falls back to system roles when the roles API returns an empty list', async () => {
    rolesData.current = [];
    const user = userEvent.setup();
    renderDialog();
    expect(await screen.findByText('Create Staff Member')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Super Admin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Merchant' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Fallback Hire');
    await user.type(screen.getByLabelText('Email'), 'fallback.hire@jad.example');
    await user.type(screen.getByLabelText('Temporary password'), 'TempPass1');
    await user.selectOptions(screen.getByLabelText('Role'), 'finance');
    await user.click(screen.getByText('Create Staff'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Fallback Hire',
        email: 'fallback.hire@jad.example',
        roleId: 'finance',
      }),
    );
  });

  it('resolves a valid role when the loaded list excludes the admin default', async () => {
    rolesData.current = [
      { id: 'finance', name: 'Finance', permissions: ['sales'], isSystem: true },
      { id: 'merchant', name: 'Merchant', permissions: ['vouchers'], isSystem: true },
    ];
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Name'), 'Default Hire');
    await user.type(screen.getByLabelText('Email'), 'default.hire@jad.example');
    await user.type(screen.getByLabelText('Temporary password'), 'TempPass1');
    // Leave the role select untouched - the dialog must submit a role that
    // actually exists in the loaded list, never the stale 'admin' default.
    await user.click(screen.getByText('Create Staff'));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'finance' }));
    expect(screen.queryByText('Select a valid role.')).not.toBeInTheDocument();
  });
});
