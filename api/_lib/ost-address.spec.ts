import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ostIdentitySchema } from '@afhomes/contracts';
const provider = vi.hoisted(() => ({ provinces: vi.fn(), provincesInRegion: vi.fn(), localities: vi.fn(), barangays: vi.fn() }));
vi.mock('./address-source.js', () => ({ addressProvider: () => provider }));
const { verifyOstAddress } = await import('./ost-address.js');
const identity = () => ostIdentitySchema.parse({ firstName: 'QA', lastName: 'TEST', email: 'qa@example.invalid', phone: '+639171234567', birthDate: '1990-01-01',
  address: { line1: 'SYNTHETIC', city: 'submitted name', province: 'submitted province', postalCode: '4000', countryCode: 'PH' },
  addressHierarchy: { regionCode: '0400000000', provinceCode: '0403400000', localityCode: '0403406000', barangayCode: '0403406003' },
});
beforeEach(() => {
  provider.provinces.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.provincesInRegion.mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]);
  provider.localities.mockResolvedValue([{ code: '0403406000', name: 'Calauan', type: 'municipality', provinceCode: '0403400000', postalCode: '4000' }]);
  provider.barangays.mockResolvedValue([{ code: '0403406003', name: 'Dayap', localityCode: '0403406000' }]);
});
describe('OST verified address boundary', () => {
  it('stores provider names instead of submitted geographic names', async () => {
    expect(await verifyOstAddress(identity())).toMatchObject({ ok: true, identity: { address: { province: 'Laguna', city: 'Calauan', barangay: 'Dayap', postalCode: '4000' } } });
  });
  it('rejects a province outside the selected region', async () => {
    provider.provincesInRegion.mockResolvedValueOnce([]);
    expect(await verifyOstAddress(identity())).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects a barangay outside the selected locality', async () => {
    provider.barangays.mockResolvedValueOnce([]);
    expect(await verifyOstAddress(identity())).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects a forged or stale postal value', async () => {
    const input = identity(); input.address.postalCode = '9999';
    expect(await verifyOstAddress(input)).toMatchObject({ ok: false, status: 400 });
  });
  it('fails closed when the reference provider is unavailable', async () => {
    provider.provincesInRegion.mockRejectedValueOnce(new Error('UNAVAILABLE'));
    expect(await verifyOstAddress(identity())).toMatchObject({ ok: false, status: 503 });
  });
});
