import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { Customer, GenealogyNode } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import { getGenealogy } from '../genealogy/services';
import { CustomerApplicationEditorPage } from './official-forms-applications';
import { getCustomersPage, getCustomerById } from './services';
import {
  HierarchyFields,
  VipRecommenderFields,
  type HierarchySelection,
  type RecommenderSelection,
} from './official-forms-fields';

vi.mock('../genealogy/services', () => ({ getGenealogy: vi.fn() }));
vi.mock('./services', async (original) => ({
  ...(await original()),
  getCustomersPage: vi.fn(),
  getCustomerById: vi.fn(),
  getCardProducts: vi.fn(async () => []),
}));

const VD1 = '22222222-2222-4222-8222-222222222222';
const VD2 = 'aaaaaaaa-0000-4000-8000-00000000000a';
const SSM1 = '33333333-3333-4333-8333-333333333333';
const SSM2 = 'bbbbbbbb-0000-4000-8000-00000000000b';
const SM1 = '44444444-4444-4444-8444-444444444444';
const SM2 = 'cccccccc-0000-4000-8000-00000000000c';
const OST1 = 'dddddddd-0000-4000-8000-00000000000d';
const OST_SUSPENDED = 'eeeeeeee-0000-4000-8000-00000000000e';
const OST_PENDING = 'ffffffff-0000-4000-8000-00000000000f';

const node = (
  staffId: string,
  fullName: string,
  role: GenealogyNode['role'],
  uplineStaffId: string | null,
  status: GenealogyNode['status'] = 'active',
  ostStatus: GenealogyNode['ostStatus'] = null,
): GenealogyNode => ({
  staffId,
  fullName,
  role,
  status,
  ostStatus,
  uplineStaffId,
  directDownlineCount: 0,
  totalDescendantCount: 0,
});

const TREE: GenealogyNode[] = [
  node(VD1, 'VD ALPHA', 'vice_director', null),
  node(VD2, 'VD BETA', 'vice_director', null),
  node(SSM1, 'SSM ALPHA ONE', 'senior_sales_manager', VD1),
  node(SSM2, 'SSM BETA ONE', 'senior_sales_manager', VD2),
  node(SM1, 'SM ALPHA ONE', 'sales_manager', SSM1),
  node(SM2, 'SM BETA ONE', 'sales_manager', SSM2),
  node(OST1, 'OST ALPHA ONE', 'ost', SM1, 'active', 'active'),
  node(OST_SUSPENDED, 'OST SUSPENDED', 'ost', SM1, 'active', 'suspended'),
  node(OST_PENDING, 'OST PENDING', 'ost', SM1, 'active', null),
  node(VD1, 'SHOULD NOT MATTER', 'vice_director', null, 'inactive'),
];

function ControlledHierarchy({
  initial = {},
  onChange,
}: {
  initial?: HierarchySelection;
  onChange: (next: HierarchySelection & { salesManagerName: string }) => void;
}) {
  const [value, setValue] = useState<HierarchySelection>(initial);
  return (
    <HierarchyFields
      value={value}
      fallbackSmName=""
      fallbackReferrerName=""
      onChange={(next) => {
        setValue({
          vdStaffId: next.vdStaffId,
          ssmStaffId: next.ssmStaffId,
          smStaffId: next.smStaffId,
          referrerOstId: next.referrerOstId,
        });
        onChange(next);
      }}
    />
  );
}

function setupHierarchy(initial: HierarchySelection = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<ControlledHierarchy initial={initial} onChange={onChange} />);
  return { onChange, user };
}

const vd = () => screen.getByRole('combobox', { name: /^Vice Director/ });
const ssm = () => screen.getByRole('combobox', { name: /^Senior Sales Manager/ });
const sm = () => screen.getByRole('combobox', { name: /^Sales Manager/ });
const ost = () => screen.getByRole('combobox', { name: /^Referring OST/ });

const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  name: string | RegExp,
) => {
  await waitFor(() => expect(box).toBeEnabled());
  await user.click(box);
  await user.click(await screen.findByRole('option', { name }));
};

beforeEach(() => {
  vi.mocked(getGenealogy).mockReset().mockResolvedValue(TREE);
});

describe('hierarchy cascade', () => {
  it('offers all four levels with dependents locked', () => {
    setupHierarchy();
    expect(vd()).toBeInTheDocument();
    expect(ssm()).toBeDisabled();
    expect(sm()).toBeDisabled();
    expect(ost()).toBeDisabled();
  });

  it('does not fetch genealogy until the selector is used', async () => {
    const { user } = setupHierarchy();
    expect(getGenealogy).not.toHaveBeenCalled();
    await user.click(vd());
    await waitFor(() => expect(getGenealogy).toHaveBeenCalledTimes(1));
  });

  it('searches VDs by name', async () => {
    const { user } = setupHierarchy();
    await user.click(vd());
    await screen.findByRole('option', { name: 'VD ALPHA' });
    await user.type(vd(), 'beta');
    expect(screen.queryByRole('option', { name: 'VD ALPHA' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'VD BETA' })).toBeInTheDocument();
  });

  it('scopes SSMs to the selected VD', async () => {
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD ALPHA');
    await user.click(ssm());
    expect(await screen.findByRole('option', { name: 'SSM ALPHA ONE' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SSM BETA ONE' })).not.toBeInTheDocument();
  });

  it('scopes SMs to the selected SSM and reports the name snapshot', async () => {
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD ALPHA');
    await choose(user, ssm(), 'SSM ALPHA ONE');
    await choose(user, sm(), 'SM ALPHA ONE');
    expect(sm()).toHaveValue('SM ALPHA ONE');
  });

  it('clears SSM and SM when the VD changes', async () => {
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD ALPHA');
    await choose(user, ssm(), 'SSM ALPHA ONE');
    await choose(user, vd(), 'VD BETA');
    expect(ssm()).toHaveValue('');
    expect(sm()).toHaveValue('');
    expect(ost()).toHaveValue('');
    await user.click(ssm());
    expect(await screen.findByRole('option', { name: 'SSM BETA ONE' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SSM ALPHA ONE' })).not.toBeInTheDocument();
  });

  it('clears SM and OST when the SSM changes', async () => {
    const { user, onChange } = setupHierarchy({ vdStaffId: VD1 });
    await choose(user, ssm(), 'SSM ALPHA ONE');
    await choose(user, sm(), 'SM ALPHA ONE');
    await choose(user, ost(), 'OST ALPHA ONE');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ referrerOstId: OST1, vipReferrer: 'OST ALPHA ONE' }),
    );
    // Only one SSM under VD ALPHA in the fixture, so switch VD to get another
    // SSM: the SM and the OST must not survive the SSM change.
    await choose(user, vd(), 'VD BETA');
    await choose(user, ssm(), 'SSM BETA ONE');
    expect(sm()).toHaveValue('');
    expect(ost()).toHaveValue('');
    expect(ost()).toBeDisabled();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ smStaffId: undefined, referrerOstId: undefined, vipReferrer: '' }),
    );
  });

  it('shows an empty state for a VD with no SSM', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([node(VD1, 'VD LONELY', 'vice_director', null)]);
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD LONELY');
    await user.click(ssm());
    expect(
      await screen.findByText('This Vice Director has no Senior Sales Manager'),
    ).toBeInTheDocument();
  });

  it('locks the OST box until a Sales Manager is chosen', () => {
    setupHierarchy();
    expect(ost()).toBeDisabled();
  });

  it('scopes OSTs to the selected SM and reports the referrer name', async () => {
    const { user, onChange } = setupHierarchy();
    await choose(user, vd(), 'VD ALPHA');
    await choose(user, ssm(), 'SSM ALPHA ONE');
    await choose(user, sm(), 'SM ALPHA ONE');
    await user.click(ost());
    expect(await screen.findByRole('option', { name: 'OST ALPHA ONE' })).toBeInTheDocument();
    // Suspended and pending-accreditation OSTs are never eligible referrers.
    expect(screen.queryByRole('option', { name: 'OST SUSPENDED' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'OST PENDING' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'OST ALPHA ONE' }));
    expect(ost()).toHaveValue('OST ALPHA ONE');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        referrerOstId: OST1,
        vipReferrer: 'OST ALPHA ONE',
        salesManagerName: 'SM ALPHA ONE',
      }),
    );
  });

  it('shows an empty state for an SM with no OST', async () => {
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD BETA');
    await choose(user, ssm(), 'SSM BETA ONE');
    await choose(user, sm(), 'SM BETA ONE');
    await user.click(ost());
    expect(await screen.findByText('This Sales Manager has no OST')).toBeInTheDocument();
  });

  it('flags a stored OST that is no longer eligible', async () => {
    setupHierarchy({
      vdStaffId: VD1,
      ssmStaffId: SSM1,
      smStaffId: SM1,
      referrerOstId: '99999999-9999-4999-8999-999999999999',
    });
    await waitFor(() => expect(getGenealogy).toHaveBeenCalled());
    expect(await screen.findByText(/no longer eligible/)).toBeInTheDocument();
  });

  it('shows an empty state when no Vice Director is eligible', async () => {
    vi.mocked(getGenealogy).mockResolvedValue([]);
    const { user } = setupHierarchy();
    await user.click(vd());
    expect(await screen.findByText('No eligible Vice Directors')).toBeInTheDocument();
  });

  it('rapid parent switching ends on the latest selection', async () => {
    const { user } = setupHierarchy();
    await choose(user, vd(), 'VD ALPHA');
    // The shared combobox opens on focus: a second click into the still-focused
    // box opens nothing, so touch another control first, exactly as an operator
    // scanning down the cascade would.
    await user.click(ssm());
    await user.click(vd());
    await user.click(await screen.findByRole('option', { name: 'VD BETA' }));
    expect(vd()).toHaveValue('VD BETA');
    expect(ssm()).toHaveValue('');
    expect(sm()).toHaveValue('');
    await user.click(ssm());
    expect(await screen.findByRole('option', { name: 'SSM BETA ONE' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'SSM ALPHA ONE' })).not.toBeInTheDocument();
  });

  it('flags a stored id that is no longer eligible', async () => {
    setupHierarchy({ vdStaffId: '99999999-9999-4999-8999-999999999999' });
    await waitFor(() => expect(getGenealogy).toHaveBeenCalled());
    expect(await screen.findByText(/no longer eligible/)).toBeInTheDocument();
  });

  it('recovers from a network failure with retry', async () => {
    vi.mocked(getGenealogy).mockRejectedValueOnce(new Error('offline'));
    const { user } = setupHierarchy();
    await user.click(vd());
    const vdBox = screen.getByTestId('recommender-vd-combobox');
    await within(vdBox).findByRole('alert');
    vi.mocked(getGenealogy).mockResolvedValue(TREE);
    await user.click(within(vdBox).getByRole('button', { name: 'Try again' }));
    // Retrying moves focus off the input, which closes the list by design, so
    // open it again like an operator would.
    await user.click(vd());
    await screen.findByRole('option', { name: 'VD ALPHA' });
  });
});

const customer = (overrides: Partial<Customer> & { id: string }): Customer =>
  ({
    customerNumber: 'AF-CUS-000001',
    customerCode: null,
    fullName: 'JUAN DELA CRUZ',
    email: 'juan@example.com',
    phone: '+639171234567',
    dateOfBirth: null,
    gender: null,
    address: null,
    governmentIdType: null,
    governmentIdMasked: null,
    status: 'active',
    createdBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }) as Customer;

const JUAN_A = customer({
  id: 'dddddddd-0000-4000-8000-00000000000a',
  customerNumber: 'AF-CUS-000001',
});
const JUAN_B = customer({
  id: 'dddddddd-0000-4000-8000-00000000000b',
  customerNumber: 'AF-CUS-000002',
  email: 'juan.b@example.com',
  phone: '+639187654321',
});
const NO_CONTACT = customer({
  id: 'dddddddd-0000-4000-8000-00000000000c',
  fullName: 'NO CONTACT',
  customerNumber: 'AF-CUS-000003',
  email: '',
  phone: '',
});

it('finds and links a recommender outside the initial page using bounded server search', async () => {
  const remote = customer({ ...JUAN_B, fullName: 'REMOTE RECOMMENDER' });
  vi.mocked(getCustomersPage).mockImplementation(async (params) => ({
    data: params?.search ? [remote] : [],
    total: params?.search ? 1 : 501,
  }));
  vi.mocked(getCustomerById).mockResolvedValue(remote);
  renderWithProviders(<CustomerApplicationEditorPage />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox', { name: 'VIP Recommender Name' }), 'REMOTE');
  await waitFor(() =>
    expect(getCustomersPage).toHaveBeenCalledWith({ search: 'REMOTE', limit: 50, offset: 0 }),
  );
  await user.click(await screen.findByRole('option', { name: /REMOTE RECOMMENDER/ }));
  await waitFor(() => expect(getCustomerById).toHaveBeenCalledWith(remote.id));
  expect(screen.getByLabelText('Recommender Contact')).toHaveValue(remote.phone);
  expect(screen.getByLabelText('Recommender Email')).toHaveValue(remote.email);
});

function ControlledRecommender({
  initial,
  customers,
  onChange,
}: {
  initial: RecommenderSelection;
  customers: Customer[];
  onChange: (next: RecommenderSelection) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <VipRecommenderFields
      value={value}
      customers={customers}
      customersLoading={false}
      customersError={null}
      onRetryCustomers={() => {}}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function setupRecommender(
  initial: RecommenderSelection = {
    vipRecommenderName: '',
    recommenderContact: '',
    recommenderEmail: '',
  },
  customers: Customer[] = [JUAN_A, JUAN_B],
) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <ControlledRecommender initial={initial} customers={customers} onChange={onChange} />,
  );
  return { onChange, user };
}

const recommenderBox = () => screen.getByRole('combobox', { name: /^VIP Recommender Name/ });

describe('VIP recommender lookup', () => {
  it('populates contact and email on select', async () => {
    const { user, onChange } = setupRecommender();
    await user.click(recommenderBox());
    await user.click(await screen.findByRole('option', { name: /AF-CUS-000001/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      recommenderCustomerId: JUAN_A.id,
      vipRecommenderName: 'JUAN DELA CRUZ',
      recommenderContact: '+639171234567',
      recommenderEmail: 'juan@example.com',
    });
  });

  it('keeps duplicate names distinguishable', async () => {
    const { user } = setupRecommender();
    await user.click(recommenderBox());
    expect(await screen.findByRole('option', { name: /AF-CUS-000001/ })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /AF-CUS-000002/ })).toBeInTheDocument();
  });

  it('updates related fields when the recommender changes', async () => {
    const { user } = setupRecommender(
      {
        recommenderCustomerId: JUAN_A.id,
        vipRecommenderName: JUAN_A.fullName,
        recommenderContact: JUAN_A.phone,
        recommenderEmail: JUAN_A.email,
      },
      [JUAN_A, JUAN_B],
    );
    await user.click(recommenderBox());
    await user.click(await screen.findByRole('option', { name: /AF-CUS-000002/ }));
    expect(screen.getByLabelText('Recommender Contact')).toHaveValue('+639187654321');
    expect(screen.getByLabelText('Recommender Email')).toHaveValue('juan.b@example.com');
  });

  it('clears auto-filled fields when the recommender is cleared', async () => {
    const { user } = setupRecommender({
      recommenderCustomerId: JUAN_A.id,
      vipRecommenderName: JUAN_A.fullName,
      recommenderContact: JUAN_A.phone,
      recommenderEmail: JUAN_A.email,
    });
    await user.click(screen.getByRole('button', { name: 'Clear vip recommender name' }));
    expect(screen.getByLabelText('Recommender Contact')).toHaveValue('');
    expect(screen.getByLabelText('Recommender Email')).toHaveValue('');
  });

  it('locks contact and email while a record is linked', async () => {
    setupRecommender({
      recommenderCustomerId: JUAN_A.id,
      vipRecommenderName: JUAN_A.fullName,
      recommenderContact: JUAN_A.phone,
      recommenderEmail: JUAN_A.email,
    });
    expect(screen.getByLabelText('Recommender Contact')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Recommender Email')).toHaveAttribute('readonly');
  });

  it('states missing contact info instead of inventing it', async () => {
    const { user } = setupRecommender(
      { vipRecommenderName: '', recommenderContact: '', recommenderEmail: '' },
      [NO_CONTACT],
    );
    await user.click(recommenderBox());
    await user.click(await screen.findByRole('option', { name: /AF-CUS-000003/ }));
    expect(screen.getByLabelText('Recommender Contact')).toHaveValue('');
    expect(screen.getByPlaceholderText('No contact on record')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('No email on record')).toBeInTheDocument();
  });

  it('flags a historical free-text entry as unlinked', () => {
    setupRecommender({
      vipRecommenderName: 'OLD NAME',
      recommenderContact: '',
      recommenderEmail: '',
    });
    expect(screen.getByText(/not linked to a record/)).toBeInTheDocument();
  });
});
