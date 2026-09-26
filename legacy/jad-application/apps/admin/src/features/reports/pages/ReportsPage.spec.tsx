import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { ReportsPage } from './ReportsPage';

describe('ReportsPage', () => {
  let server: ReturnType<typeof installMockApi>;
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let revokeObjectURL: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('renders the page header and empty state before generating', () => {
    renderWithProviders(<ReportsPage />, { user: MOCK_ADMIN, route: '/admin/reports' });
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText('No report yet')).toBeInTheDocument();
  });

  it('generates and renders the sales & commissions report', async () => {
    renderWithProviders(<ReportsPage />, { user: MOCK_ADMIN, route: '/admin/reports' });
    // Default range (current month start) excludes the seeded August sales;
    // clear the From date so the full mock data set is in range.
    const fromInput = screen.getByLabelText('Report from date');
    fireEvent.change(fromInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await screen.findByText('Summary (all time – today)');
    expect(screen.getByText('Qualifying sales value')).toBeInTheDocument();
    expect(
      (await screen.findAllByText('250 SQM Farm Lot with Hotspring')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThanOrEqual(1);
    // Commission rows derived from earning sales in the mock store.
    expect((await screen.findAllByText('Direct Commission')).length).toBeGreaterThanOrEqual(1);
  });

  it('downloads the sales report as CSV', async () => {
    renderWithProviders(<ReportsPage />, { user: MOCK_ADMIN, route: '/admin/reports' });
    fireEvent.change(screen.getByLabelText('Report from date'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const downloadButton = await screen.findByRole('button', {
      name: 'Download CSV (sales + commissions)',
    });
    fireEvent.click(downloadButton);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('summary tab shows the empty state while nothing has been generated (no idle-query skeleton)', () => {
    renderWithProviders(<ReportsPage />, { user: MOCK_ADMIN, route: '/admin/reports' });
    fireEvent.click(screen.getByRole('tab', { name: 'Operational Summary' }));
    // TanStack v5 keeps a disabled query in status 'pending' - the page must
    // not render the loading skeleton until the user presses Generate.
    expect(screen.getByText('No report yet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('generates and downloads the operational summary report', async () => {
    renderWithProviders(<ReportsPage />, { user: MOCK_ADMIN, route: '/admin/reports' });
    fireEvent.click(screen.getByRole('tab', { name: 'Operational Summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await screen.findByText('Active members');
    expect(screen.getByText('New inquiries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
