import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, within } from '../../test/utils';
import { sellerOfRecordBlocker } from './SellerOfRecordPicker';
import { RecommenderFields, type ReferralChainIds } from './official-forms-fields';

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const OST = id(1);
const SM1 = id(2);
const SM2 = id(3);
const SSM2 = id(5);
const SM_SELF = id(8);

const node = (
  staffId: string,
  fullName: string,
  role: string,
  uplineStaffId: string | null,
  status = 'active',
) => ({
  staffId,
  fullName,
  role,
  status,
  ostStatus: role === 'ost' ? 'active' : null,
  uplineStaffId,
  directDownlineCount: 0,
  totalDescendantCount: 0,
});

vi.mock('../genealogy/services', () => ({
  getGenealogy: async () => [
    node('00000000-0000-4000-8000-000000000001', 'Referrer Ost', 'ost', '00000000-0000-4000-8000-000000000002'),
    node('00000000-0000-4000-8000-000000000002', 'Team Manager', 'sales_manager', '00000000-0000-4000-8000-000000000004'),
    node('00000000-0000-4000-8000-000000000003', 'Other Manager', 'sales_manager', '00000000-0000-4000-8000-000000000005'),
    node('00000000-0000-4000-8000-000000000004', 'Team Senior', 'senior_sales_manager', '00000000-0000-4000-8000-000000000006'),
    node('00000000-0000-4000-8000-000000000005', 'Other Senior', 'senior_sales_manager', null),
    node('00000000-0000-4000-8000-000000000006', 'Team Director', 'vice_director', null),
    node('00000000-0000-4000-8000-000000000007', 'Dormant Manager', 'sales_manager', null, 'inactive'),
    node('00000000-0000-4000-8000-000000000008', 'Self Manager', 'sales_manager', '00000000-0000-4000-8000-000000000005'),
  ],
  getOstMemberContacts: async () => ({}),
  resolveAaNumber: async () => ({ member: null }),
  getAccreditationNumbers: async () => ({
    '00000000-0000-4000-8000-000000000002': 'AAI-0002',
    '00000000-0000-4000-8000-000000000003': 'AAI-0003',
    '00000000-0000-4000-8000-000000000008': 'AAI-0008',
  }),
}));

const account = (roleSlug: string, extra: Record<string, unknown> = {}) => ({
  id: SM_SELF,
  name: 'Self Manager',
  roleSlug,
  status: 'active' as const,
  ...extra,
});

/** Stateful host standing in for the application page. */
function Host({
  acct,
  onSeller,
}: {
  acct: ReturnType<typeof account>;
  onSeller: (id: string) => void;
}) {
  const [seller, setSeller] = useState('');
  const [chain, setChain] = useState<ReferralChainIds>({
    svdStaffId: '',
    ssmStaffId: '',
    smStaffId: '',
    referrerStaffId: OST,
  });
  const [extra, setExtra] = useState<Record<string, string>>({});
  const meta = {
    ...chain,
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
    acknowledgedAt: '',
    referrerAaNumber: '',
    recommenderAaNumber: '',
    recommenderStaffId: '',
    ...extra,
  };
  return (
    <>
      <RecommenderFields
        networkSelection
        meta={meta}
        chainNames={{}}
        onChange={(key, value) => setExtra((current) => ({ ...current, [key]: value }))}
        onChain={setChain}
        seller={{
          account: acct,
          value: seller,
          onChange: (next) => {
            setSeller(next);
            onSeller(next);
          },
        }}
      />
      <output data-testid="chain">{JSON.stringify(chain)}</output>
    </>
  );
}

const panel = () => screen.findByRole('region', { name: 'SM / SSM / SVD upline' });

describe('seller of record blocker', () => {
  it('requires nothing from an SM, an SM from Admin, and refuses OST or inactive accounts', () => {
    expect(sellerOfRecordBlocker({ roleSlug: 'sales_manager', status: 'active' }, '')).toBeNull();
    expect(sellerOfRecordBlocker({ roleSlug: 'admin', status: 'active' }, '')).toMatch(
      /Network step/,
    );
    expect(sellerOfRecordBlocker({ roleSlug: 'admin', status: 'active' }, SM1)).toBeNull();
    expect(sellerOfRecordBlocker({ roleSlug: 'ost', status: 'active' }, SM1)).toMatch(
      /cannot create/,
    );
    expect(sellerOfRecordBlocker({ roleSlug: 'admin', status: 'suspended' }, SM1)).toMatch(
      /cannot create/,
    );
  });
});

describe('seller of record in the Network step', () => {
  it('shows an SM creator their own account read-only and sends nothing', async () => {
    const onSeller = vi.fn();
    renderWithProviders(<Host acct={account('sales_manager')} onSeller={onSeller} />);
    const region = within(await panel());
    expect(await region.findByText(/Self Manager/)).toBeInTheDocument();
    expect(await region.findByText(/AAI-0008/)).toBeInTheDocument();
    expect(region.queryByLabelText('Seller of record')).toBeNull();
    // SSM follows the SM's own upline.
    expect(region.getByText(/Other Senior/)).toBeInTheDocument();
    expect(onSeller).not.toHaveBeenCalled();
  });

  it('defaults an Admin to the referrer team SM, lets them change it, and SSM/SVD follow', async () => {
    const user = userEvent.setup();
    const onSeller = vi.fn();
    renderWithProviders(<Host acct={account('admin')} onSeller={onSeller} />);
    const select = await screen.findByLabelText('Seller of record');
    await vi.waitFor(() => expect(select).toHaveValue(SM1));
    expect(onSeller).toHaveBeenLastCalledWith(SM1);
    expect(screen.queryByText(/not the referrer's team SM/)).toBeNull();
    // Only active Sales Managers are offered.
    expect(screen.queryByRole('option', { name: /Dormant Manager/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Team Senior/ })).toBeNull();
    const region = within(await panel());
    expect(region.getByText(/Team Senior/)).toBeInTheDocument();
    expect(region.getByText(/Team Director/)).toBeInTheDocument();

    await user.selectOptions(select, SM2);
    expect(onSeller).toHaveBeenLastCalledWith(SM2);
    expect(await screen.findByText(/Selected SM is not the referrer's team SM/)).toBeInTheDocument();
    expect(select).toHaveValue(SM2);
    // SSM follows the SELECTED SM; the old team's SVD is gone.
    expect(region.getByText(/Other Senior/)).toBeInTheDocument();
    expect(region.queryByText(/Team Director/)).toBeNull();
    // The submitted chain follows the selection too, keeping the referrer.
    expect(JSON.parse(screen.getByTestId('chain').textContent!)).toMatchObject({
      smStaffId: SM2,
      ssmStaffId: SSM2,
      referrerStaffId: OST,
    });
  });

  it('finds Sales Managers by name or AAI number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host acct={account('super_admin')} onSeller={() => {}} />);
    await screen.findByLabelText('Seller of record');
    await screen.findByRole('option', { name: 'Other Manager · AAI-0003' });
    await user.type(screen.getByLabelText('Search Sales Managers'), 'AAI-0003');
    expect(screen.getByRole('option', { name: 'Other Manager · AAI-0003' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Self Manager/ })).toBeNull();
  });

  it('shows OST no picker', async () => {
    renderWithProviders(<Host acct={account('ost')} onSeller={() => {}} />);
    await panel();
    expect(screen.queryByLabelText('Seller of record')).toBeNull();
  });
});
