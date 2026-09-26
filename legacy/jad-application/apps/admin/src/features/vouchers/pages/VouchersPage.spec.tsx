import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { resetVoucherStore } from '../../../mock/voucherMockStore';
import { VouchersPage } from './VouchersPage';

describe('VouchersPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    resetVoucherStore();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders the vouchers header with create and scan actions', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Vouchers')).toBeInTheDocument();
    expect(screen.getByText('Create Voucher')).toBeInTheDocument();
    expect(screen.getByText('Scan QR')).toBeInTheDocument();
  });

  it('renders voucher definitions with assigned counts', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Welcome Gift')).toBeInTheDocument();
    expect(screen.getByText('Referral Rewards')).toBeInTheDocument();
    expect(screen.getByText('Season Promo')).toBeInTheDocument();
  });

  it('shows formatted currency values', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Welcome Gift');
    expect(screen.getAllByText('₱500.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('₱1,000.00')).toBeInTheDocument();
  });

  it('shows assignment counts', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Welcome Gift');
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the create voucher dialog with no member selector', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Welcome Gift');
    await userEvent.click(screen.getByText('Create Voucher'));
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Original Value')).toBeInTheDocument();
    expect(screen.queryByLabelText('Member')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expiry Date')).not.toBeInTheDocument();
  });

  it('edits a voucher title and persists the change', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Season Promo');

    const rows = await screen.findAllByRole('row');
    const seasonRow = rows.find((row) => row.textContent?.includes('Season Promo'));
    expect(seasonRow).toBeDefined();
    await userEvent.click(
      within(seasonRow as HTMLElement).getByRole('button', {
        name: 'Edit',
      }),
    );

    const titleInput = screen.getByLabelText('Title');
    expect(titleInput).toHaveValue('Season Promo');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Season Super Promo');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Season Super Promo')).toBeInTheDocument();
    expect(screen.queryByText('Season Promo')).not.toBeInTheDocument();
  });

  it('rejects an empty voucher title in the edit dialog', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Season Promo');

    const rows = await screen.findAllByRole('row');
    const seasonRow = rows.find((row) => row.textContent?.includes('Season Promo'));
    await userEvent.click(
      within(seasonRow as HTMLElement).getByRole('button', {
        name: 'Edit',
      }),
    );

    const titleInput = screen.getByLabelText('Title');
    await userEvent.clear(titleInput);
    // Save stays disabled on an untouched-but-empty title; typing+clearing
    // triggers the inline validation path instead.
    await userEvent.type(titleInput, 'x');
    await userEvent.clear(titleInput);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Season Promo')).toBeInTheDocument();
  });

  it('deletes a voucher after confirmation and revokes its assignments', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Season Promo');

    const rows = await screen.findAllByRole('row');
    const seasonRow = rows.find((row) => row.textContent?.includes('Season Promo'));
    await userEvent.click(
      within(seasonRow as HTMLElement).getByRole('button', {
        name: 'Delete',
      }),
    );

    expect(
      screen.getByText(/permanently delete "Season Promo"/i),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await screen.findByText('Welcome Gift');
    expect(screen.queryByText('Season Promo')).not.toBeInTheDocument();
  });

  it('keeps the voucher when the delete confirmation is cancelled', async () => {
    renderWithProviders(<VouchersPage />, { user: MOCK_ADMIN });
    await screen.findByText('Season Promo');

    const rows = await screen.findAllByRole('row');
    const seasonRow = rows.find((row) => row.textContent?.includes('Season Promo'));
    await userEvent.click(
      within(seasonRow as HTMLElement).getByRole('button', {
        name: 'Delete',
      }),
    );
    const cancelDialog = await screen.findByRole('dialog');
    await userEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Season Promo')).toBeInTheDocument();
  });
});
