/**
 * Client-side submit normalization (admin SPA).
 *
 * Mirrors the server's shared contracts (`@afhomes/contracts` input schemas) so a
 * form shows the stored form immediately. The server remains authoritative: a
 * caller that bypasses these helpers is still validated and normalized by the
 * API schemas on write.
 *
 * NEVER normalized here (passed through exactly): emails are lowercased only,
 * and passwords, tokens, URLs, UUIDs, hashes, keys, storage paths, notes and
 * free-form descriptions are never case-folded.
 */
import {
  normalizeAddressField,
  normalizeEmail,
  normalizeGeographicName,
  normalizePersonName,
  normalizePhilippinePhone,
  normalizePostalCode,
  type CreateCustomerApplicationRequest,
  type CreateCustomerRequest,
  type CreateReservationAgreementRequest,
} from '@afhomes/contracts';

const upper = (value: string): string => normalizePersonName(value);
const upperOpt = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? value : upper(value);
const upperAddress = (value: string): string => normalizeAddressField(value);
const upperAddressOpt = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? value : upperAddress(value);

// Live editing preserves whitespace and cursor positions; trimming belongs to
// submission. Technical fields deliberately have no entry in this allowlist.
const LIVE_UPPERCASE_FIELDS = new Set([
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'suffix',
  'name',
  'line1',
  'line2',
  'city',
  'province',
  'postalCode',
  'address',
  'permanentAddressLine1',
  'permanentAddressLine2',
  'cityMunicipality',
  'occupationBusinessName',
  'officeBusinessAddress',
  'employedPosition',
  'printedName',
  'salesManagerName',
  'vipRecommenderName',
  'vipReferrer',
]);

export function normalizeLiveHumanField(field: string, value: string): string {
  if (
    [
      'fullName',
      'firstName',
      'middleName',
      'lastName',
      'name',
      'printedName',
      'salesManagerName',
      'vipRecommenderName',
      'vipReferrer',
      'suffix',
    ].includes(field)
  )
    return value;
  return LIVE_UPPERCASE_FIELDS.has(field) ? value.toUpperCase() : value;
}

/** Staff/customer display name + email for invite and create payloads. */
export function normalizeStaffIdentity(input: { email: string; fullName: string }): {
  email: string;
  fullName: string;
} {
  return {
    email: normalizeEmail(input.email) ?? input.email,
    fullName: upper(input.fullName),
  };
}

/** My Account display name. */
export function normalizeProfileName(name: string): string {
  return upper(name);
}

export function normalizeCustomerRequest(input: CreateCustomerRequest): CreateCustomerRequest {
  return {
    ...input,
    firstName: upper(input.firstName),
    middleName: upperOpt(input.middleName),
    lastName: upper(input.lastName),
    suffix: upperOpt(input.suffix),
    email: normalizeEmail(input.email) ?? input.email,
    phone: normalizePhilippinePhone(input.phone) ?? input.phone,
    address: {
      ...input.address,
      line1: upperAddress(input.address.line1),
      line2: upperAddressOpt(input.address.line2),
      city: upperAddress(input.address.city),
      province: upperAddress(input.address.province),
      postalCode: input.address.postalCode
        ? normalizePostalCode(input.address.postalCode)
        : input.address.postalCode,
      countryCode: (input.address.countryCode ?? 'PH').toUpperCase(),
    },
  };
}

type ApplicationHolder =
  | CreateCustomerApplicationRequest['primary']
  | NonNullable<CreateCustomerApplicationRequest['secondary']>;

function normalizeApplicationHolder<T extends ApplicationHolder>(holder: T): T {
  return {
    ...holder,
    lastName: upper(holder.lastName),
    firstName: upper(holder.firstName),
    middleName: upperOpt(holder.middleName),
    suffix: upperOpt(holder.suffix),
    permanentAddressLine1: upperAddress(holder.permanentAddressLine1),
    permanentAddressLine2: upperAddressOpt(holder.permanentAddressLine2),
    officeBusinessAddress: upperAddressOpt(holder.officeBusinessAddress),
    /**
     * Official geographic names, chosen from the authority's list. Their casing is
     * the record, so `upperAddress` would be wrong here: it would store
     * `LAGUNA` where the authority published `Laguna`. Whitespace is still
     * collapsed, because that is not information.
     */
    cityMunicipality: normalizeGeographicName(holder.cityMunicipality),
    province: normalizeGeographicName(holder.province),
    barangay: holder.barangay ? normalizeGeographicName(holder.barangay) : holder.barangay,
    postalCode: holder.postalCode ? normalizePostalCode(holder.postalCode) : holder.postalCode,
    mobile: normalizePhilippinePhone(holder.mobile) ?? holder.mobile,
    email: normalizeEmail(holder.email) ?? holder.email,
    occupationBusinessName: upperAddressOpt(holder.occupationBusinessName),
    employedPosition: upperAddressOpt(holder.employedPosition),
    printedName: upper(holder.printedName),
  };
}

export function normalizeCustomerApplicationRequest<T extends CreateCustomerApplicationRequest>(
  input: T,
): T {
  return {
    ...input,
    primary: normalizeApplicationHolder(input.primary),
    secondary: input.secondary ? normalizeApplicationHolder(input.secondary) : input.secondary,
    salesManagerName: upperOpt(input.salesManagerName),
    vipRecommenderName: upperOpt(input.vipRecommenderName),
    vipReferrer: upperOpt(input.vipReferrer),
  };
}

type ReservationHolder =
  | CreateReservationAgreementRequest['primary']
  | NonNullable<CreateReservationAgreementRequest['secondary']>;

function normalizeReservationHolder<T extends ReservationHolder>(holder: T): T {
  return {
    ...holder,
    name: upper(holder.name),
    address: upperAddress(holder.address),
    contactNumber: normalizePhilippinePhone(holder.contactNumber) ?? holder.contactNumber,
    email: normalizeEmail(holder.email) ?? holder.email,
  };
}

export function normalizeReservationAgreementRequest<T extends CreateReservationAgreementRequest>(
  input: T,
): T {
  return {
    ...input,
    primary: normalizeReservationHolder(input.primary),
    secondary: input.secondary ? normalizeReservationHolder(input.secondary) : input.secondary,
  };
}
