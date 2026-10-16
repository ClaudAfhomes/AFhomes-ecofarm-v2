import { describe, it, expect } from 'vitest';
import { resolvePostalCode } from './postal-reference.js';
import { psgcCloudAddressProvider } from './psgc-cloud-provider.js';
import { vi, afterEach } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
describe('national postal reference', () => {
  it.each([
    ['Laguna', 'Victoria', '4011'],
    ['Laguna', 'Calauan', '4012'],
    ['Cebu', 'Cebu City', '6000'],
    ['Benguet', 'Baguio City', '2600'],
    ['Iloilo', 'Iloilo City', '5000'],
    ['Davao del Sur', 'Davao City', '8000'],
    ['Misamis Oriental', 'Cagayan de Oro City', '9000'],
    ['Zamboanga del Sur', 'Zamboanga City', '7000'],
    ['Masbate', 'Cawayan', '5409'], ['Camarines Norte', 'Capalonga', '4607'],
    ['Albay', 'Oas', '4505'], ['Surigao del Sur', 'Cagwait', '8304'],
    ['Cagayan', 'Gonzaga', '3513'], ['Cagayan', 'Alcala', '3507'],
  ])('resolves %s / %s without using the PSGC ZIP', (province, city, postalCode) => {
    expect(resolvePostalCode(province!, city!)).toEqual({ status: 'matched', postalCode });
  });
  it('resolves NCR by city and barangay, never the same barangay in another city', () => {
    expect(resolvePostalCode('Metro Manila', 'Quezon City', 'Payatas')).toEqual({
      status: 'matched',
      postalCode: '1119',
    });
    expect(resolvePostalCode('Metro Manila', 'Makati City', 'Payatas').status).toBe('review');
    expect(resolvePostalCode('Metro Manila', 'Quezon City').status).toBe('review');
  });
  it.each([
    ['Davao de Oro', 'Monkayo', '8805'],
    ['Samar', 'Catbalogan', '6700'],
    ['Occidental Mindoro', 'Mamburao', '5106'],
    ['Oriental Mindoro', 'Calapan', '5200'],
    ['Cotabato', 'Kidapawan', '9400'],
    ['South Cotabato', 'Koronadal', '9506'],
    ['Surigao del Norte', 'Dapa', '8417'],
    ['Kalinga', 'Balbalan', '3801'],
    ['Apayao', 'Conner', '3807'],
    ['Maguindanao del Norte', 'Parang', '9604'],
    ['Maguindanao del Sur', 'Buluan', '9616'],
    ['Quezon', 'Agdangan', '4304'],
  ])('maps the current PSGC province name %s onto the dated reference', (province, city, postalCode) => {
    expect(resolvePostalCode(province!, city!)).toEqual({ status: 'matched', postalCode });
  });
  it('keeps a stored reference-era spelling working', () => {
    expect(resolvePostalCode('Western Samar', 'Catbalogan')).toEqual({
      status: 'matched',
      postalCode: '6700',
    });
    expect(resolvePostalCode('Quezon Province', 'Lucena City')).toEqual({
      status: 'matched',
      postalCode: '4301',
    });
    expect(resolvePostalCode('North Cotobato', 'Kidapawan')).toEqual({
      status: 'matched',
      postalCode: '9400',
    });
  });
  it('resolves canonical Marikina and Caloocan names, holding city-only lookups', () => {
    expect(resolvePostalCode('Metro Manila', 'Marikina City', 'Barangka')).toEqual({
      status: 'matched',
      postalCode: '1803',
    });
    expect(resolvePostalCode('Metro Manila', 'Marikina City').status).toBe('review');
    expect(resolvePostalCode('Metro Manila', 'Caloocan City', 'Bagong Silang')).toEqual({
      status: 'matched',
      postalCode: '1428',
    });
    expect(resolvePostalCode('Metro Manila', 'Caloocan City', 'Grace Park West')).toEqual({
      status: 'matched',
      postalCode: '1406',
    });
    expect(resolvePostalCode('Metro Manila', 'Caloocan City').status).toBe('review');
  });
  it('holds unknown geography rather than fabricating a code', () => {
    expect(resolvePostalCode('Laguna', 'Unknown').status).toBe('review');
    expect(resolvePostalCode('Cebu', 'Victoria').status).toBe('review');
    expect(resolvePostalCode('Laguna', 'Calamba City', 'Canlubang').status).toBe('review');
  });
  it('corrects an inaccurate upstream ZIP at the shared provider boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  code: '0403430000',
                  name: 'Victoria',
                  province: 'Laguna',
                  type: 'Mun',
                  zip_code: '4018',
                },
              ],
            }),
          ),
      ),
    );
    expect((await psgcCloudAddressProvider.localities('0403400000'))[0]?.postalCode).toBe('4011');
  });
});
