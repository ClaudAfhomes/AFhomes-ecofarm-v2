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
  toTitleCase,
  type CreateCustomerApplicationRequest,
  type CreateCustomerRequest,
  type CreateReservationAgreementRequest,
} from '@afhomes/contracts';
import { formatTin } from './format';

const upper = (value: string): string => normalizePersonName(value);
const upperOpt = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? value : upper(value);
const upperAddress = (value: string): string => normalizeAddressField(value);
const upperAddressOpt = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? value : upperAddress(value);

/**
 * Live title-casing for the application holder fields. `toTitleCase` trims and
 * collapses for storage; this keeps the typed whitespace intact so a trailing
 * space survives while the operator is still on the word.
 *
 * The first LETTER of each word is capitalised, not merely its first character:
 * a word may legitimately open with punctuation or a house number ("(Unit 4-B",
 * "#12 Mabini"), and upper-casing "(" or "4" would leave the real first letter
 * lowercase.
 */
export const titleCaseLive = (value: string): string =>
  value.replace(/\S+/g, (word) => {
    const first = word.search(/\p{L}/u);
    if (first < 0) return word;
    return word.slice(0, first) + word[first]!.toUpperCase() + word.slice(first + 1).toLowerCase();
  });

/** Live filter for name fields: drop anything a person name can never contain. */
export const filterHolderNameInput = (value: string): string =>
  titleCaseLive(value.replace(/[^\p{L}\p{M}'’.\- ]/gu, ''));

/**
 * Live filter for the holder's street lines.
 *
 * An address is NOT a name: house numbers, unit designators and the punctuation
 * that carries them are the address. So digits and the punctuation a real
 * Philippine address uses survive; what goes is everything else — control
 * characters, emoji, angle brackets and quotes, none of which any address
 * contains and all of which break the stored text downstream.
 */
export const filterHolderAddressInput = (value: string): string =>
  titleCaseLive(value.replace(/[^\p{L}\p{M}\p{N} .,'’\-&#/()!+%:@]/gu, ''));

/**
 * Live filter for the free-text business fields (occupation, office address,
 * industry, employed position).
 *
 * Same reasoning as the street line, plus the ampersand and plus sign real
 * employers carry: "3M Philippines", "Sales & Marketing", "C++ Developer",
 * "Level 3 Manager" are all legitimate answers. The rule is "letters, digits
 * and the punctuation a business name uses" — not a person-name allowlist.
 */
export const filterBusinessTextInput = (value: string): string =>
  value.replace(/[^\p{L}\p{M}\p{N} .,'’\-&#/()!+%:@]/gu, '');

/** Live filter for TIN input: digits and dashes only. */
export const filterTinInput = (value: string): string => value.replace(/[^\d-]/g, '').slice(0, 15);

/** Live TIN input: digits only, grouped as 123-456-789 (optional branch). */
export const formatTinInput = (value: string): string =>
  formatTin(value.replace(/\D/g, '').slice(0, 14));

/** Live filter for member TIN input: digits only, max 9. */
export const filterMemberTinInput = (value: string): string =>
  value.replace(/\D/g, '').slice(0, 9);

/** Live filter for Philippine mobile input: digits only, max 11. */
export const filterMobileInput = (value: string): string =>
  value.replace(/\D/g, '').slice(0, 11);

/** Live filter for landline input: digits and dialing punctuation only. */
export const filterLandlineInput = (value: string): string =>
  value.replace(/[^0-9+().\- ]/g, '').slice(0, 20);

/** Live filter for government ID numbers: letters, digits and dashes, max 16. */
export const filterGovernmentIdInput = (value: string): string =>
  value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 16);

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
  // Email always stays lowercase while typing: uppercase is never valid.
  if (['email', 'recommenderEmail'].includes(field)) return value.toLowerCase();
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
    // Company-stated fields: same rules as the handler. Names collapse
    // whitespace (no case invention), PH mobiles canonicalize, emails
    // lowercase; every other verbatim field passes through for Zod trim.
    supplementaryFullName: input.supplementaryFullName
      ? upper(input.supplementaryFullName)
      : input.supplementaryFullName,
    supplementaryMobile: input.supplementaryMobile
      ? (normalizePhilippinePhone(input.supplementaryMobile) ?? input.supplementaryMobile)
      : input.supplementaryMobile,
    supplementaryEmail: input.supplementaryEmail
      ? (normalizeEmail(input.supplementaryEmail) ?? input.supplementaryEmail)
      : input.supplementaryEmail,
    relatedContactNo: input.relatedContactNo
      ? (normalizePhilippinePhone(input.relatedContactNo) ?? input.relatedContactNo)
      : input.relatedContactNo,
    relatedEmail: input.relatedEmail
      ? (normalizeEmail(input.relatedEmail) ?? input.relatedEmail)
      : input.relatedEmail,
  };
}

type ApplicationHolder =
  | CreateCustomerApplicationRequest['primary']
  | NonNullable<CreateCustomerApplicationRequest['secondary']>;

function normalizeApplicationHolder<T extends ApplicationHolder>(holder: T): T {
  return {
    ...holder,
    // Names and street lines are stored Title Case so the saved form reads as
    // words; the server re-applies the same rule on write.
    lastName: toTitleCase(holder.lastName),
    firstName: toTitleCase(holder.firstName),
    middleName: holder.middleName ? toTitleCase(holder.middleName) : holder.middleName,
    suffix: upperOpt(holder.suffix),
    permanentAddressLine1: toTitleCase(holder.permanentAddressLine1),
    permanentAddressLine2: holder.permanentAddressLine2
      ? toTitleCase(holder.permanentAddressLine2)
      : holder.permanentAddressLine2,
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
    printedName: toTitleCase(holder.printedName),
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
    svdName: input.svdName ? toTitleCase(input.svdName) : input.svdName,
    ssmName: input.ssmName ? toTitleCase(input.ssmName) : input.ssmName,
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
