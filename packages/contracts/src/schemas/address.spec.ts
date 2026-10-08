import { describe, expect, it } from 'vitest';

import {
  addressHierarchyQuerySchema,
  barangaySchema,
  geographicCodeSchema,
  localitySchema,
  provinceSchema,
} from './address.js';
import { applicationHolderSchema, createCustomerApplicationSchema } from './official-forms.js';

describe('geographicCodeSchema', () => {
  it('accepts a 10-digit PSGC code', () => {
    expect(geographicCodeSchema.parse('0403400000')).toBe('0403400000');
  });

  it('rejects a name typed where a code belongs', () => {
    expect(geographicCodeSchema.safeParse('Laguna').success).toBe(false);
  });

  it('rejects a 9-digit legacy-shaped code', () => {
    // PSGC moved to 10-digit codes; a shorter code is a different vintage and
    // must not be silently accepted into a 10-digit column.
    expect(geographicCodeSchema.safeParse('403400000').success).toBe(false);
  });
});

describe('provinceSchema', () => {
  it('keeps the provider name verbatim, including its casing', () => {
    expect(provinceSchema.parse({ code: '0403400000', name: 'Laguna' })).toEqual({
      code: '0403400000',
      name: 'Laguna',
    });
  });
});

describe('localitySchema', () => {
  it('carries the city type and its province', () => {
    expect(
      localitySchema.parse({
        code: '0403403000',
        name: 'City of Binan',
        type: 'city',
        provinceCode: '0403400000',
      }),
    ).toMatchObject({ type: 'city', provinceCode: '0403400000' });
  });

  it('carries the municipality type', () => {
    expect(
      localitySchema.parse({
        code: '0403406000',
        name: 'Calauan',
        type: 'municipality',
        provinceCode: '0403400000',
      }).type,
    ).toBe('municipality');
  });

  it('refuses a locality that claims to be neither a city nor a municipality', () => {
    expect(
      localitySchema.safeParse({
        code: '0403406000',
        name: 'Calauan',
        type: 'district',
        provinceCode: '0403400000',
      }).success,
    ).toBe(false);
  });

  it('refuses a locality with no province', () => {
    expect(
      localitySchema.safeParse({ code: '0403406000', name: 'Calauan', type: 'municipality' })
        .success,
    ).toBe(false);
  });
});

describe('barangaySchema', () => {
  it('records the locality it belongs to', () => {
    expect(
      barangaySchema.parse({ code: '0403406003', name: 'Dayap', localityCode: '0403406000' }),
    ).toEqual({ code: '0403406003', name: 'Dayap', localityCode: '0403406000' });
  });
});

describe('addressHierarchyQuerySchema', () => {
  it('accepts a bare code', () => {
    expect(addressHierarchyQuerySchema.parse('0403400000')).toBe('0403400000');
  });

  it('refuses a province name', () => {
    expect(addressHierarchyQuerySchema.safeParse('Laguna').success).toBe(false);
  });
});

/** A holder with only the fields a province-based submission needs. */
const holderBase = {
  holderType: 'PRIMARY' as const,
  lastName: 'SANTOS',
  firstName: 'ANA',
  birthDate: '1990-01-01',
  permanentAddressLine1: '1 RPC Street',
  cityMunicipality: 'Calauan',
  province: 'Laguna',
  mobile: '+639171234567',
  email: 'ana@example.test',
  printedName: 'ANA SANTOS',
};

/** The submission boundary, where the all-or-nothing code rule actually lives. */
const application = (primary: Record<string, unknown>) =>
  createCustomerApplicationSchema.safeParse({
    customerId: '11111111-1111-4111-8111-111111111111',
    planId: '11111111-1111-4111-8111-111111111111',
    tier: 'BRONZE',
    paymentScheme: 'spot_cash',
    primary,
    consentAcknowledged: true,
    acknowledgedAt: '2026-10-01',
    primarySignatureStatus: 'received',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
  });

describe('applicationHolderSchema geographic fields', () => {
  it('carries a verified triple', () => {
    const parsed = applicationHolderSchema.parse({
      ...holderBase,
      barangay: 'Dayap',
      provinceCode: '0403400000',
      cityMunicipalityCode: '0403406000',
      barangayCode: '0403406003',
    });

    expect(parsed).toMatchObject({
      barangay: 'Dayap',
      provinceCode: '0403400000',
      cityMunicipalityCode: '0403406000',
      barangayCode: '0403406003',
    });
  });

  it('accepts a holder with no codes at all, which is every legacy record', () => {
    const parsed = applicationHolderSchema.parse(holderBase);

    expect(parsed.provinceCode).toBeUndefined();
    expect(parsed.barangay).toBeUndefined();
  });

  it('rejects a half-verified hierarchy', () => {
    // Two codes and no barangay would store a parent/child pair the authority
    // never confirmed. All three or none.
    expect(application({ ...holderBase, provinceCode: '0403400000', cityMunicipalityCode: '0403406000' }).success).toBe(
      false,
    );
  });

  it('rejects a half-verified hierarchy on the SECONDARY holder alone', () => {
    // Each holder is judged on its own: a verified primary with an unverified
    // secondary must not slip through because the primary was complete.
    const withSecondary = (secondary: Record<string, unknown>) =>
      createCustomerApplicationSchema.safeParse({
        customerId: '11111111-1111-4111-8111-111111111111',
        planId: '11111111-1111-4111-8111-111111111111',
        tier: 'GOLD',
        paymentScheme: 'spot_cash',
        primary: { ...holderBase, barangay: 'Dayap', provinceCode: '0403400000', cityMunicipalityCode: '0403406000', barangayCode: '0403406003' },
        secondary: {
          ...holderBase,
          holderType: 'SECONDARY',
          provinceCode: '0403400000',
        },
        consentAcknowledged: true,
        acknowledgedAt: '2026-10-01',
        primarySignatureStatus: 'received',
        secondarySignatureStatus: 'received',
        validIdReceived: false,
        reservationPaymentProofReceived: false,
        ...secondary,
      });

    expect(withSecondary({}).success).toBe(false);
    expect(
      withSecondary({
        secondary: {
          ...holderBase,
          holderType: 'SECONDARY',
          barangay: 'Dayap',
          provinceCode: '0403400000',
          cityMunicipalityCode: '0403406000',
          barangayCode: '0403406003',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a code that is not a PSGC code', () => {
    expect(
      applicationHolderSchema.safeParse({
        ...holderBase,
        barangay: 'Dayap',
        provinceCode: 'Laguna',
        cityMunicipalityCode: '0403406000',
        barangayCode: '0403406003',
      }).success,
    ).toBe(false);
  });

  it('keeps a provider-supplied province name in its official casing', () => {
    // The authority's spelling is the record. Upper-casing it would rewrite
    // `Laguna` into `LAGUNA` for no benefit and would make the stored value
    // disagree with what the selector showed.
    expect(applicationHolderSchema.parse(holderBase).province).toBe('Laguna');
  });

  it('keeps a provider-supplied city name in its official casing', () => {
    expect(
      applicationHolderSchema.parse({ ...holderBase, cityMunicipality: 'City of Biñan' })
        .cityMunicipality,
    ).toBe('City of Biñan');
  });

  it('still upper-cases a typed street line, which is the existing convention', () => {
    expect(applicationHolderSchema.parse(holderBase).permanentAddressLine1).toBe('1 RPC STREET');
  });

  it('collapses stray whitespace in a geographic name without touching its casing', () => {
    expect(applicationHolderSchema.parse({ ...holderBase, province: '  Laguna  ' }).province).toBe(
      'Laguna',
    );
  });
});