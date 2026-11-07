import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { GenealogyNode } from '@afhomes/contracts';
import { renderWithProviders } from '../../test/utils';
import { ApplicationNetworkSelection } from './ApplicationNetworkSelection';
import { EMPTY_APPLICATION_CHAIN } from './application-network';

const node = (
  staffId: string,
  role: GenealogyNode['role'],
  uplineStaffId: string | null,
): GenealogyNode => ({
  staffId,
  fullName: staffId,
  role,
  uplineStaffId,
  status: 'active',
  ostStatus: null,
  directDownlineCount: 0,
  totalDescendantCount: 0,
});
const nodes = [
  node('Director', 'vice_director', null),
  node('Head A', 'sales_manager', 'Director'),
  node('Head B', 'sales_manager', 'Director'),
  node('Referrer A', 'ost', 'Head A'),
  node('Referrer B', 'ost', 'Head B'),
];
function Harness() {
  const [kind, setKind] = useState<'OST' | 'IST'>('OST');
  const [chain, setChain] = useState(EMPTY_APPLICATION_CHAIN);
  return (
    <ApplicationNetworkSelection
      nodes={nodes}
      kind={kind}
      onKindChange={setKind}
      chain={chain}
      onChain={setChain}
      loading={false}
      failed={false}
    />
  );
}
it('offers OST first, fills the actual head, and clears it when the classification changes', () => {
  renderWithProviders(<Harness />);
  const radios = screen.getAllByRole('radio');
  expect(radios[0]).toHaveAccessibleName('OST');
  expect(radios[0]).toBeChecked();
  fireEvent.change(screen.getByLabelText('Referring OST member'), {
    target: { value: 'Referrer A' },
  });
  expect(screen.getByText('Head A', { selector: 'strong' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Referring OST member'), {
    target: { value: 'Referrer B' },
  });
  expect(screen.queryByText('Head A', { selector: 'strong' })).not.toBeInTheDocument();
  expect(screen.getByText('Head B', { selector: 'strong' })).toBeVisible();
  fireEvent.click(screen.getByRole('radio', { name: 'IST' }));
  expect(screen.queryByText('Head B', { selector: 'strong' })).not.toBeInTheDocument();
  expect(screen.getByText('Select a referring member')).toBeVisible();
  expect(screen.getByLabelText('Referring IST member')).toHaveValue('');
});
