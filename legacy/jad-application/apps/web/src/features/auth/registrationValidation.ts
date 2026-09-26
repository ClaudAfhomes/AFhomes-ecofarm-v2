import {
  GENERIC_E164_RULE,
  MAX_NAME_LENGTH,
  normalizeMiddleInitial,
  normalizeName,
  parseBirthDate,
  personNameSchema,
  toPhoneRule,
  validatePhoneNumber,
  type PhoneCountryRule,
} from '@jad/contracts';
import type { IdDocument, QualificationAnswer } from '@jad/contracts';

/**
 * Multi-step registration draft validation (SCR-AUTH-002/005).
 * UX validation only - the client is never the security boundary. Field
 * rules delegate to the shared validators in `@jad/contracts` so client
 * feedback and server enforcement can never disagree. Normative rules stay
 * within documented requirements (BR-REG-001..013); the 8-character password
 * minimum remains ASSUMPTION 1 (TBD) as in the login/register previews.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const SPONSOR_CODE_MAX_LENGTH = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

/** Phone metadata for one country, as served by GET /config/public. */
export interface CountryPhoneMeta {
  code: string;
  name: string;
  dialCode?: string;
  phoneMin?: number;
  phoneMax?: number;
  phonePattern?: string;
}

export interface RegistrationDraft {
  programId: string;
  firstName: string;
  middleInitial: string;
  /** Explicit "no middle name" choice - submitted as empty, never "N/A". */
  noMiddleInitial: boolean;
  lastName: string;
  nameSuffix: string;
  dateOfBirth: string;
  gender: string;
  genderOther: string;
  countryCode: string;
  /** Street/building/unit line (optional free text). */
  address: string;
  /** Philippine hierarchy codes (PSGC) - required together when country is PH. */
  provinceCode: string;
  cityCode: string;
  barangayCode: string;
  /** Non-PH structured address - required together for other countries. */
  region: string;
  city: string;
  /**
   * Dial digits for the phone field (e.g. '63'), selected from the
   * country-code dropdown. Defaults to the verified country's dial and never
   * mutates `countryCode` - the server stays authoritative for the country.
   */
  phoneDial: string;
  /** National significant number digits only (dial/trunk stripped at input). */
  phone: string;
  answers: Record<string, string>;
  referralCode: string;
  idDocument?: IdDocument;
  email: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
}

export function createEmptyDraft(): RegistrationDraft {
  return {
    programId: '',
    firstName: '',
    middleInitial: '',
    noMiddleInitial: false,
    lastName: '',
    nameSuffix: '',
    dateOfBirth: '',
    gender: '',
    genderOther: '',
    countryCode: '',
    address: '',
    provinceCode: '',
    cityCode: '',
    barangayCode: '',
    region: '',
    city: '',
    phoneDial: '',
    phone: '',
    answers: {},
    referralCode: '',
    idDocument: undefined,
    email: '',
    password: '',
    confirmPassword: '',
    consent: false,
  };
}

/**
 * Build the effective phone rule for a country from config metadata,
 * falling back to generic E.164 when the country carries no (valid) rule.
 */
export function buildPhoneRule(
  countries: CountryPhoneMeta[] | undefined,
  countryCode: string,
): PhoneCountryRule {
  const row = countries?.find((candidate) => candidate.code === countryCode);
  if (!row) return { ...GENERIC_E164_RULE };
  return toPhoneRule({
    countryCode,
    dialCode: row.dialCode,
    min: row.phoneMin,
    max: row.phoneMax,
    pattern: row.phonePattern,
  });
}

/** One entry of the phone field's country-code dropdown. */
export interface DialCodeOption {
  /** Dial digits without '+', e.g. '63'. */
  dial: string;
  /** ISO code of the (first) country carrying this dial. */
  countryCode: string;
  label: string;
}

const DIAL_RE = /^[0-9]{1,4}$/;

/**
 * Dial-code dropdown options from public config. Countries without a valid
 * dial code are skipped; duplicate dials collapse to their first country
 * (shared dials such as +1 validate against that country's rule).
 */
export function dialCodeOptions(
  countries: CountryPhoneMeta[] | undefined,
): DialCodeOption[] {
  const options: DialCodeOption[] = [];
  for (const row of countries ?? []) {
    if (!row.dialCode || !DIAL_RE.test(row.dialCode)) continue;
    if (options.some((option) => option.dial === row.dialCode)) continue;
    options.push({
      dial: row.dialCode,
      countryCode: row.code,
      label: `+${row.dialCode} ${row.name}`,
    });
  }
  return options;
}

/**
 * Effective phone rule for a selected dial code (first country carrying the
 * dial wins), falling back to generic E.164 for unknown dials.
 */
export function buildPhoneRuleForDial(
  countries: CountryPhoneMeta[] | undefined,
  dial: string,
): PhoneCountryRule {
  const row = countries?.find((candidate) => candidate.dialCode === dial);
  if (!row) return { ...GENERIC_E164_RULE };
  return toPhoneRule({
    countryCode: row.code,
    dialCode: row.dialCode,
    min: row.phoneMin,
    max: row.phoneMax,
    pattern: row.phonePattern,
  });
}

/** Largest national length a rule allows (drives input truncation). */
export function maxNationalLength(rule: PhoneCountryRule): number {
  return rule.nationalLengths.length > 0 ? Math.max(...rule.nationalLengths) : 15;
}

/**
 * Sanitize raw phone input to national digits capped at `maxLen`. Strips
 * every non-digit, then drops an embedded dial code or trunk `0` only when
 * the digit string overflows (a bare national number never exceeds `maxLen`,
 * so overflow proves a prefix rode along - paste, autofill, `+63 ...`). The
 * result is always slice-capped, so typing and pasting can never exceed the
 * country's limit; length/format enforcement stays in `validatePhoneNumber`.
 */
export function sanitizeNationalInput(rawValue: string, dial: string, maxLen: number): string {
  let digits = rawValue.replace(/\D/g, '');
  if (digits === '') return '';
  if (dial !== '' && digits.length > maxLen && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  }
  while (digits.startsWith('0') && digits.length > maxLen) {
    digits = digits.slice(1);
  }
  return digits.slice(0, maxLen);
}

/**
 * Split a legacy stored phone value (persisted draft, member profile, all
 * canonical E.164 `+<dial><national>`) into dial + national parts. Never
 * truncates - overlong values stay overlong so validation flags them.
 */
export function splitStoredPhone(
  stored: string,
  countries: CountryPhoneMeta[] | undefined,
  countryCode: string,
): { dial: string; national: string } {
  const rows = countries ?? [];
  const verified = rows.find((row) => row.code === countryCode);
  const verifiedDial =
    verified?.dialCode && DIAL_RE.test(verified.dialCode) ? verified.dialCode : '';
  const digits = stored.replace(/\D/g, '');
  if (digits === '') return { dial: verifiedDial, national: '' };
  // Prefer the verified country's dial for the bare dial-code form.
  if (verifiedDial !== '' && digits.startsWith(verifiedDial)) {
    return { dial: verifiedDial, national: digits.slice(verifiedDial.length) };
  }
  const other = rows.find(
    (row) => row.dialCode && DIAL_RE.test(row.dialCode) && digits.startsWith(row.dialCode),
  );
  if (other?.dialCode) return { dial: other.dialCode, national: digits.slice(other.dialCode.length) };
  if (digits.startsWith('0') && verifiedDial !== '') {
    return { dial: verifiedDial, national: digits.slice(1) };
  }
  return { dial: verifiedDial, national: digits };
}

/** Compose the canonical E.164 submit value from dial + national digits. */
export function composeE164Phone(dial: string, national: string): string {
  const digits = national.replace(/\D/g, '');
  if (digits === '') return '';
  return dial !== '' ? `+${dial}${digits}` : `+${digits}`;
}

/** Phone field: required, then dial-rule validation on the composed value. */
export function validatePhoneFieldWithDial(
  national: string,
  dial: string,
  countries: CountryPhoneMeta[] | undefined,
): string | undefined {
  if (!national.trim()) return 'Enter your phone number.';
  if (!validatePhoneNumber(composeE164Phone(dial, national), buildPhoneRuleForDial(countries, dial))) {
    return 'Enter a valid phone number.';
  }
  return undefined;
}

/** Person-name field: required, charset-pinned, length-capped (shared core). */
export function validatePersonNameField(value: string, label: string): string | undefined {
  if (!normalizeName(value)) return `Enter your ${label.toLowerCase()}.`;
  const result = personNameSchema.safeParse(value);
  if (result.success) return undefined;
  if (result.error.issues.some((issue) => issue.code === 'too_big')) {
    return `${label} must be ${MAX_NAME_LENGTH} characters or less.`;
  }
  return `Enter a valid ${label.toLowerCase()}.`;
}

/** Middle initial: explicit N/A skips; otherwise one letter (`A.` folds to `A`). */
export function validateMiddleInitialField(
  value: string,
  noMiddleInitial: boolean,
): string | undefined {
  if (noMiddleInitial) return undefined;
  if (!value.trim()) return 'Enter your middle initial or select N/A.';
  const normalized = normalizeMiddleInitial(value);
  if (/^[A-Z]$/.test(normalized)) return undefined;
  return 'Use one letter (A-Z) for your middle initial, or select N/A.';
}

/** Phone field: required, then country-rule validation on the normalized value. */
export function validatePhoneField(
  phone: string,
  countryCode: string,
  countries: CountryPhoneMeta[] | undefined,
): string | undefined {
  if (!phone.trim()) return 'Enter your phone number.';
  if (!validatePhoneNumber(phone, buildPhoneRule(countries, countryCode))) {
    return 'Enter a valid phone number.';
  }
  return undefined;
}

/** Birth-date field: immediate invalid/today/future/underage feedback. */
export function validateBirthDateField(
  dateOfBirth: string,
  minAge: number,
  now: Date = new Date(),
): string | undefined {
  if (!dateOfBirth.trim()) return 'Enter your date of birth.';
  const parsed = parseBirthDate(dateOfBirth, now);
  if (!parsed.ok) return 'Enter a valid date of birth.';
  if ((parsed.age ?? 0) < minAge) {
    return `You must be at least ${minAge} years old to join.`;
  }
  return undefined;
}

/** Philippine hierarchy completeness (membership is enforced server-side). */
export function validatePhilippineAddress(draft: RegistrationDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.provinceCode.trim()) errors.provinceCode = 'Select your province.';
  if (!draft.cityCode.trim()) errors.cityCode = 'Select your city/municipality.';
  if (!draft.barangayCode.trim()) errors.barangayCode = 'Select your barangay.';
  return errors;
}

/** Non-PH structured address completeness. */
export function validateGenericAddress(draft: RegistrationDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.region.trim()) errors.region = 'Enter your region/state.';
  else if (draft.region.trim().length > MAX_NAME_LENGTH) {
    errors.region = `Region/state must be ${MAX_NAME_LENGTH} characters or less.`;
  }
  if (!draft.city.trim()) errors.city = 'Enter your city.';
  else if (draft.city.trim().length > MAX_NAME_LENGTH) {
    errors.city = `City must be ${MAX_NAME_LENGTH} characters or less.`;
  }
  return errors;
}

export function cutoffDateForMinAge(minAge: number, now = new Date()): string {
  const y = now.getFullYear() - minAge;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Step 0 - program choice + personal profile (BR-REG-001/002/008/010/011). */
export function validateProgramProfile(
  draft: RegistrationDraft,
  minAge: number,
  countries?: CountryPhoneMeta[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.programId) errors.programId = 'Select a program.';
  const firstNameError = validatePersonNameField(draft.firstName, 'First name');
  if (firstNameError) errors.firstName = firstNameError;
  const middleInitialError = validateMiddleInitialField(draft.middleInitial, draft.noMiddleInitial);
  if (middleInitialError) errors.middleInitial = middleInitialError;
  const lastNameError = validatePersonNameField(draft.lastName, 'Last name');
  if (lastNameError) errors.lastName = lastNameError;
  const dateOfBirthError = validateBirthDateField(draft.dateOfBirth, minAge);
  if (dateOfBirthError) errors.dateOfBirth = dateOfBirthError;
  if (!draft.gender) errors.gender = 'Select your gender.';
  else if (draft.gender === 'Others' && !draft.genderOther.trim()) {
    errors.genderOther = 'Please specify your gender identity.';
  } else if (draft.gender === 'Others' && draft.genderOther.trim().length > 60) {
    errors.genderOther = 'Gender identity must be 60 characters or less.';
  }
  if (!draft.countryCode) errors.countryCode = 'Select your country.';
  // Split-field drafts validate the national digits against the selected
  // dial; pre-migration drafts (persisted v2, resubmit prefill) still hold
  // the full string and validate against the country rule until the form's
  // migration effect splits them.
  const phoneError = draft.phoneDial
    ? validatePhoneFieldWithDial(draft.phone, draft.phoneDial, countries)
    : validatePhoneField(draft.phone, draft.countryCode, countries);
  if (phoneError) errors.phone = phoneError;
  if (draft.countryCode === 'PH') {
    Object.assign(errors, validatePhilippineAddress(draft));
  } else if (draft.countryCode) {
    Object.assign(errors, validateGenericAddress(draft));
  }
  return errors;
}

/** Step 1 - qualification questions answered (FR-REG-003; content TBD OD-002). */
export function validateQualification(
  answers: Record<string, string>,
  questions: { id: string; questionText: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const question of questions) {
    if (!answers[question.id]?.trim()) {
      errors[`answer_${question.id}`] = 'Answer this question to continue.';
    }
  }
  return errors;
}

/** Step 2 - optional referral code (BR-REG-006; validated server-side). */
export function validateReferralCode(referralCode: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (referralCode.trim().length > SPONSOR_CODE_MAX_LENGTH) {
    errors.referralCode = 'Referral code is too long.';
  }
  return errors;
}

/** Step 3 - government ID upload (FR-REG-002, FEAT-010). File bytes ride along
 * as base64 for the API upload; metadata alone is a legacy shape. */
export function validateIdDocument(idDocument: IdDocument | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!idDocument) {
    errors.idDocument = 'Attach a clear copy of a valid government-issued ID.';
  } else if (idDocument.sizeBytes > MAX_FILE_BYTES) {
    errors.idDocument = 'File is too large - attach an ID copy under 5 MB.';
  }
  return errors;
}

/** Step 4 - account credentials + terms consent. */
export function validateAccount(draft: RegistrationDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const email = draft.email.trim();
  if (!email) errors.email = 'Enter your email address.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (!draft.password) errors.password = 'Enter a password.';
  else if (draft.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!draft.confirmPassword) errors.confirmPassword = 'Confirm your password.';
  else if (draft.confirmPassword !== draft.password)
    errors.confirmPassword = 'Passwords do not match.';
  if (!draft.consent)
    errors.consent = 'Please accept the member terms and privacy policy to continue.';
  return errors;
}

export interface FullDraftContext {
  minAge: number;
  countries?: CountryPhoneMeta[];
  questions?: { id: string; questionText: string }[];
}

/**
 * Whole-draft validation for final submission. Step-by-step checks can be
 * bypassed through persisted-draft tampering or devtools edits, so submit
 * re-validates everything against the same rules (the server enforces them
 * again independently). Resubmit mode has no account step, so account
 * fields are skipped there.
 */
export function validateFullDraft(
  draft: RegistrationDraft,
  context: FullDraftContext,
  options?: { includeAccount?: boolean },
): Record<string, string> {
  return {
    ...validateProgramProfile(draft, context.minAge, context.countries),
    ...(context.questions ? validateQualification(draft.answers, context.questions) : {}),
    ...validateReferralCode(draft.referralCode),
    ...validateIdDocument(draft.idDocument),
    ...(options?.includeAccount === false ? {} : validateAccount(draft)),
  };
}

/** Step index owning a field id (answer_* belongs to the qualification step). */
export function stepForField(field: string): number {
  if (field.startsWith('answer_')) return 1;
  for (const [step, order] of Object.entries(STEP_FIELD_ORDER)) {
    if ((order as string[]).includes(field)) return Number(step);
  }
  return 0;
}

/** First invalid field id, in display order - for focus management. */
export function firstInvalidField(
  errors: Record<string, string>,
  order: string[],
): string | undefined {
  return order.find((field) => errors[field] !== undefined);
}

export function answersToQualification(
  answers: Record<string, string>,
  questions: { id: string }[],
): QualificationAnswer[] {
  return questions
    .filter((question) => answers[question.id]?.trim())
    .map((question) => ({ questionId: question.id, answer: answers[question.id]!.trim() }));
}

/** Step field id order for focus management. */
export const STEP_FIELD_ORDER: Record<number, string[]> = {
  0: [
    'programId',
    'firstName',
    'middleInitial',
    'lastName',
    'nameSuffix',
    'dateOfBirth',
    'gender',
    'genderOther',
    'countryCode',
    'address',
    'provinceCode',
    'cityCode',
    'barangayCode',
    'region',
    'city',
    'phoneDial',
    'phone',
  ],
  1: ['qualification'],
  2: ['referralCode'],
  3: ['idDocument'],
  4: ['email', 'password', 'confirmPassword', 'consent'],
};
