import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { CustomerApplicationEditorPage, humanizeApplicationIssues } from './OfficialFormsPages';
import {
  getCardProducts,
  getCustomersPage,
  getCustomerById,
  getCustomerImportPrefill,
} from './services';
vi.mock('../../lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/client')>()),
  setApiAccessTokenForTests: vi.fn(),
}));

vi.mock('./services', () => ({
  getCardProducts: vi.fn(),
  getCustomersPage: vi.fn(),
  getCustomerById: vi.fn(),
  getCustomerImportPrefill: vi.fn(),
  getCustomerApplication: vi.fn(),
  getPurchaseTermsProposal: vi.fn(),
  createCustomerApplication: vi.fn(),
  registerCustomerApplication: vi.fn(),
  decideCustomerApplication: vi.fn(),
  getReservationAgreements: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reviewApplicationPurchaseTerms: vi.fn(),
  submitCustomerApplication: vi.fn(),
  updateCustomerApplication: vi.fn(),
}));
vi.mock('../documents/services', () => ({
  ACCEPTED_MIME: ['image/jpeg', 'image/png', 'application/pdf'],
  MAX_BYTES: 10485760,
  getCurrentDocument: vi.fn(),
  completeDocumentUpload: vi.fn(),
  putUploadBytes: vi.fn(),
  requestUploadGrant: vi.fn(),
}));
vi.mock('./import-workflow-services', () => ({ getImportRowIntake: vi.fn() }));
vi.mock('../genealogy/services', () => ({
  getGenealogy: vi.fn(async () => []),
  getOstMemberContacts: vi.fn(async () => ({})),
  resolveAaNumber: vi.fn(async () => ({ member: null })),
  getAccreditationNumbers: vi.fn(async () => ({})),
}));
const plan = { id: '00000000-0000-4000-8000-000000000010', name: 'Gold', code: 'GOLD' };
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(getCardProducts).mockResolvedValue([plan] as never);
});
afterEach(() => vi.unstubAllEnvs());

it('does not offer or fetch existing customers for ordinary new applications', async () => {
  renderWithProviders(<CustomerApplicationEditorPage />);
  await screen.findByRole('radio', { name: 'Gold' });
  expect(screen.queryByLabelText('Customer')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Load imported customer details' }),
  ).not.toBeInTheDocument();
  expect(getCustomersPage).not.toHaveBeenCalled();
  expect(getCustomerById).not.toHaveBeenCalled();
  expect(getCustomerImportPrefill).not.toHaveBeenCalled();
});

it('ignores an existing customer ID and a review-step shortcut in the URL', async () => {
  renderWithProviders(<CustomerApplicationEditorPage />, {
    route:
      '/admin/customers/applications/new?customerId=00000000-0000-4000-8000-000000000099&step=6',
  });
  await screen.findByRole('radio', { name: 'Gold' });
  expect(screen.queryByLabelText('Customer')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument();
  expect(getCustomerById).not.toHaveBeenCalled();
});

it('never restores an old customer association from a saved new-application draft', async () => {
  vi.stubEnv('MODE', 'development');
  sessionStorage.setItem(
    'afhomes.customerApplication.draft',
    JSON.stringify({ customerId: '00000000-0000-4000-8000-000000000099' }),
  );
  renderWithProviders(<CustomerApplicationEditorPage />);
  await screen.findByRole('radio', { name: 'Gold' });
  expect(getCustomerById).not.toHaveBeenCalled();
  expect(getCustomersPage).not.toHaveBeenCalled();
});

it('keeps payment card selection mutually exclusive', async () => {
  renderWithProviders(<CustomerApplicationEditorPage />);
  const spot = screen.getByRole('radio', { name: 'Spot Cash' });
  const move = screen.getByRole('radio', { name: /Move A/ });
  expect(spot).toBeChecked();
  fireEvent.click(move);
  expect(move).toBeChecked();
  expect(spot).not.toBeChecked();
});

it('explains plan-loading failures and supports retry', async () => {
  vi.mocked(getCardProducts)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue([plan] as never);
  renderWithProviders(<CustomerApplicationEditorPage />);
  await screen.findByText('VIP plans could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(await screen.findByRole('radio', { name: 'Gold' })).toBeVisible();
});

it('summarizes holder validation without raw schema details or repeated messages', () => {
  const result = humanizeApplicationIssues([
    { path: ['primary', 'firstName'], message: 'Invalid input' },
    { path: ['primary', 'mobile'], message: 'Invalid phone' },
  ]);
  expect(result).toBe("Review the primary holder's identity, address and contact fields.");
});
