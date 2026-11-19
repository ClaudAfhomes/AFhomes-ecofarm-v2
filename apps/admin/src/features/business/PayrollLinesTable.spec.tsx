import { render, screen } from '@testing-library/react';
import type { PayrollLine } from '@afhomes/contracts';
import { describe, expect, it } from 'vitest';

import { PayrollLinesTable, plainReason } from './PayrollLinesTable';

const line = (n: number, name: string, over: Partial<PayrollLine> = {}): PayrollLine => ({
  id: `66666666-0000-4000-8000-00000000000${n}`,
  batchId: '77777777-0000-4000-8000-000000000001',
  staffId: `88888888-0000-4000-8000-00000000000${n}`,
  staffName: name,
  rank: 'SM',
  status: 'computed',
  blockedReason: null,
  policyId: null,
  ba: '1000.00',
  pa: '0.00',
  pb: '0.00',
  adjustments: '0.00',
  withheld: '0.00',
  net: '1000.00',
  reviewRequired: false,
  reviewFlags: [],
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  disbursement: null,
  ...over,
});

describe('PayrollLinesTable', () => {
  it('keeps combined setup reasons readable without internal blocker tokens', () => {
    const reason = plainReason(
      'CONFIGURATION_REQUIRED: no approved policy; MISSING_ENGAGEMENT (no approved IST engagement); RULE_NOT_APPROVED',
    );
    expect(reason).toContain('No approved policy');
    expect(reason).toContain('no approved IST engagement');
    expect(reason).toContain('No performance rule is approved for this month.');
    expect(reason).not.toMatch(/CONFIGURATION_REQUIRED|MISSING_ENGAGEMENT|RULE_NOT_APPROVED/);
  });
  it('lists exceptions first: blocked, then awaiting review, then the rest in their order', () => {
    render(
      <PayrollLinesTable
        lines={[
          line(1, 'ALPHA'),
          line(2, 'BRAVO', { reviewRequired: true }),
          line(3, 'CHARLIE', {
            status: 'blocked',
            blockedReason:
              'CONFIGURATION_REQUIRED: no approved compensation policy for SM in 2026-11',
            ba: null,
            pa: null,
            pb: null,
            adjustments: null,
            withheld: null,
            net: null,
          }),
          line(4, 'DELTA'),
          line(5, 'ECHO', { reviewRequired: true, reviewedAt: '2026-11-10T00:00:00.000Z' }),
        ]}
      />,
    );
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(names).toEqual(['CHARLIE', 'BRAVO', 'ALPHA', 'DELTA', 'ECHO']);
    // The developer code is never shown; the plain explanation is.
    expect(screen.queryByText(/CONFIGURATION_REQUIRED/)).toBeNull();
    expect(screen.getByText(/no approved compensation policy for SM/i)).toBeInTheDocument();
  });
  it('shows read-only payment states instead of unavailable actions', () => {
    render(
      <PayrollLinesTable
        lines={[line(1, 'UNPAID'), line(2, 'ZERO', { net: '0.00' })]}
        onReconcile={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Record disbursement' })).toBeNull();
    expect(screen.getByText('Payment not recorded.')).toBeInTheDocument();
    expect(screen.getByText('Nothing to pay.')).toBeInTheDocument();
  });

  it('offers payment only for a positive payable line with a recording action', () => {
    render(
      <PayrollLinesTable
        lines={[line(1, 'PAYABLE'), line(2, 'ZERO', { net: '0.00' })]}
        onDisburse={() => {}}
      />,
    );
    const actions = screen.getAllByRole('button', { name: 'Record disbursement' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toBeEnabled();
  });
});
