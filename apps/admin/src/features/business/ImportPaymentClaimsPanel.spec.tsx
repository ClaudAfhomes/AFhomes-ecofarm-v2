import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { ImportPaymentClaimsPanel } from './ImportPaymentClaimsPanel';
import { getImportClaims, reconcileImportClaim } from './import-workflow-services';
vi.mock('./import-workflow-services', () => ({
  getImportClaims: vi.fn(),
  reconcileImportClaim: vi.fn(),
  uploadImportReceipt: vi.fn(),
  getImportReceipt: vi.fn(),
}));
const user: SessionUser = {
  id: 'u',
  name: 'Finance',
  email: 'finance@example.invalid',
  roleId: 'r',
  roleSlug: 'super_admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [],
};
const claim = {
  id: 'claim',
  sourceId: 'source',
  paymentKey: 'RF receipt',
  purpose: 'reservation',
  amount: '10000.00',
  date: '2026-10-16',
  method: 'cash',
  reference: 'receipt',
  notes: 'Synthetic receipt note',
  status: 'claim' as const,
  paymentId: null,
  expectedClaimVersion: 'a'.repeat(64),
  expectedTargetVersion: 'b'.repeat(64),
  duplicateCandidates: [],
  proofDocumentId: null,
  proofUploaded: false,
};
describe('Finance imported payment review', () => {
  it('keeps a way back when the final claim page is empty', async () => {
    vi.mocked(getImportClaims).mockImplementation(async (_id, offset) =>
      offset
        ? []
        : Array.from({ length: 100 }, (_, i) => ({
            ...claim,
            id: `claim-${i}`,
            status: 'verified' as const,
          })),
    );
    renderWithProviders(<ImportPaymentClaimsPanel reservationId="reservation" />, { user });
    await userEvent.click(await screen.findByRole('button', { name: 'More payment claims' }));
    expect(
      await screen.findByRole('button', { name: 'Previous payment claims' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(getImportClaims).toHaveBeenCalledWith('reservation', 100));
    await userEvent.click(screen.getByRole('button', { name: 'Previous payment claims' }));
    expect(await screen.findByRole('button', { name: 'More payment claims' })).toBeInTheDocument();
  });
  it('does not record on load and requires an uploaded receipt before acceptance', async () => {
    vi.mocked(getImportClaims).mockResolvedValue([claim]);
    vi.mocked(reconcileImportClaim).mockClear();
    renderWithProviders(<ImportPaymentClaimsPanel reservationId="reservation" />, { user });
    expect(
      await screen.findByRole('button', { name: 'Accept as unverified payment' }),
    ).toBeDisabled();
    expect(reconcileImportClaim).not.toHaveBeenCalled();
  });
  it('records only on explicit acceptance and sends both review revisions', async () => {
    const reviewed = { ...claim, proofDocumentId: 'proof', proofUploaded: true };
    vi.mocked(getImportClaims).mockResolvedValue([reviewed]);
    vi.mocked(reconcileImportClaim).mockResolvedValue({});
    renderWithProviders(<ImportPaymentClaimsPanel reservationId="reservation" />, { user });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Accept as unverified payment' }),
    );
    await waitFor(() =>
      expect(reconcileImportClaim).toHaveBeenCalledWith(
        reviewed,
        { kind: 'record', proofDocumentId: 'proof' },
        expect.any(String),
      ),
    );
  });
});
