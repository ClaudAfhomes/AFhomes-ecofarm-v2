import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type { CustomerImportParseResponse } from '@jad/contracts';
import { CustomerImportExportPage } from './CustomerImportExportPage';
import { confirmCustomerImport, parseCustomerImport } from './services';

vi.mock('../../lib/session', () => ({
  useSession: () => ({
    user: { afHomesPermissions: [{ moduleKey: 'governance.customer_import', canCreate: true }] },
  }),
}));
vi.mock('../../lib/api/client', () => ({ requestList: async () => [] }));
vi.mock('./services', () => ({
  cancelCustomerImport: vi.fn(),
  confirmCustomerImport: vi.fn(),
  exportCustomers: vi.fn(),
  getCustomerImportJobs: async () => [],
  getCustomerImportTemplate: vi.fn(),
  parseCustomerImport: vi.fn(),
}));

const preview: CustomerImportParseResponse = {
  job: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    sourceType: 'google_sheets',
    sourceName: 'QA',
    googleSheetId: 'DisposableSheet',
    status: 'validated',
    totalRows: 1,
    validRows: 1,
    invalidRows: 0,
    insertedRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    failedRows: 0,
    createdAt: '2026-01-01T00:00:00Z',
    validatedAt: '2026-01-01T00:00:00Z',
    committedAt: null,
    failedAt: null,
    cancelledAt: null,
  },
  rows: [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      rowNumber: 2,
      fields: { first_name: 'CLAUD', last_name: 'JIMENEZ', email: 'claud@example.com' },
      normalized: {},
      validation: 'valid',
      errors: [],
      warnings: [],
      action: 'CREATE',
      customerId: null,
      membershipId: null,
    },
  ],
};

it('successful Confirm Import invalidates actual Memberships/Lookup keys and refreshes an active stale list', async () => {
  let committed = false;
  const fetchMembers = vi.fn(async () =>
    committed ? ['IMPORTED MEMBERSHIP'] : ['OLD MEMBERSHIP'],
  );
  function MembershipList() {
    const members = useQuery({
      queryKey: ['memberships', 'active'],
      queryFn: fetchMembers,
      staleTime: Infinity,
    });
    return <p>{members.data?.join(',')}</p>;
  }
  vi.mocked(parseCustomerImport).mockResolvedValue(preview);
  vi.mocked(confirmCustomerImport).mockImplementation(async () => {
    committed = true;
    return {
      job: { ...preview.job, status: 'completed', insertedRows: 1 },
      committed: 1,
      failed: 0,
      rowResults: [],
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['member-lookup', 'CLAUD'], ['stale']);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MembershipList />
        <CustomerImportExportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('OLD MEMBERSHIP')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Import Google Sheet/), {
    target: { value: 'https://docs.google.com/spreadsheets/d/DisposableSheet/edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Read sheet' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm Import (1 rows)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByText('IMPORTED MEMBERSHIP')).toBeInTheDocument();
  expect(screen.queryByText('OLD MEMBERSHIP')).not.toBeInTheDocument();
  expect(fetchMembers).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['memberships'] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-lookup'] });
  expect(client.getQueryState(['member-lookup', 'CLAUD'])?.isInvalidated).toBe(true);
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['business', 'memberships'] });
  view.unmount();
  client.clear();
});
