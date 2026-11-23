import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OstAddressFields, emptyOstAddress } from './OstAddressFields';

const lookup = <T,>(data: T[]) => ({ data, isFetching: false, isError: false, refetch: vi.fn() });
const value = { regionCode: '0400000000', region: 'CALABARZON', provinceCode: '0403400000', province: 'Laguna',
  localityCode: '0403406000', city: 'Calauan', barangayCode: '0403406003', barangay: 'Dayap', postalCode: '4000' };
const options = {
  regions: lookup([{ code: '1300000000', name: 'NCR' }]), provinces: lookup([{ code: '0406100000', name: 'Batangas' }]),
  localities: lookup([{ code: '0403403000', name: 'Biñan', type: 'city' as const, provinceCode: value.provinceCode }]),
  barangays: lookup([{ code: '0403406004', name: 'Poblacion', localityCode: value.localityCode }]),
};
describe('shared OST address cascade', () => {
  it('clears every child and the ZIP when the region changes', async () => {
    const user = userEvent.setup(); const onChange = vi.fn();
    render(<OstAddressFields value={value} onChange={onChange} {...options} />);
    await user.click(screen.getByRole('combobox', { name: /^Region/ }));
    await user.click(screen.getByRole('option', { name: 'NCR' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyOstAddress(), regionCode: '1300000000', region: 'NCR' });
  });
  it('clears a stale ZIP and barangay when the new locality has no unique postal match', async () => {
    const user = userEvent.setup(); const onChange = vi.fn();
    render(<OstAddressFields value={value} onChange={onChange} {...options} />);
    await user.click(screen.getByRole('combobox', { name: /^City/ }));
    await user.click(screen.getByRole('option', { name: /^Biñan/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, localityCode: '0403403000', city: 'Biñan', barangayCode: '', barangay: '', postalCode: '' });
  });
  it('keeps the reference ZIP when selecting a barangay', async () => {
    const user = userEvent.setup(); const onChange = vi.fn();
    render(<OstAddressFields value={value} onChange={onChange} {...options} />);
    await user.click(screen.getByRole('combobox', { name: /^Barangay/ }));
    await user.click(screen.getByRole('option', { name: 'Poblacion' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, barangayCode: '0403406004', barangay: 'Poblacion' });
  });
});
