/**
 * Official-form field kit.
 *
 * Shared inputs, labels, tier vocabulary, and paging constants for the customer-application and reservation-agreement editors.
 */
import { HumanInput as NormalizedInput } from '../../lib/HumanInput';
import { useId, useState } from 'react';
import type { ApplicationHolder } from '@afhomes/contracts';
import { birthDateSchema } from '@afhomes/contracts';
import styles from './OfficialFormsPages.module.css';
import { normalizeLiveHumanField } from '../../lib/normalize';
import { GeographicAddressFields } from '../address/GeographicAddressFields';

export const today = () => new Date().toISOString().slice(0, 10);
export const emptyHolder = (holderType: 'PRIMARY' | 'SECONDARY'): ApplicationHolder => ({
  holderType,
  lastName: '',
  firstName: '',
  birthDate: '',
  permanentAddressLine1: '',
  cityMunicipality: '',
  province: '',
  mobile: '',
  email: '',
  printedName: '',
});
export const asBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Human file size for the import status line, so the chosen file is confirmable. */
export const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Form labels for a raw state key: `contactNumber` -> `Contact Number`.
 *
 * These groups are iterated straight off their state objects, so the key IS the
 * field identity. Displaying it raw leaks camelCase into the UI and reads as a
 * variable, not a label; the keys with brand spellings get an explicit entry
 * because a generic split cannot know them.
 */
export const FIELD_LABEL_OVERRIDES: Record<string, string> = { tinNumber: 'TIN Number' };
export const fieldLabel = (key: string) =>
  FIELD_LABEL_OVERRIDES[key] ??
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');

/**
 * The VIP tiers the schema accepts, as a closed choice.
 *
 * A dropdown rather than a text box: the value is a closed enum, so free typing
 * could only ever produce a value the server rejects. It also keeps the stored
 * value and the displayed option in lockstep, which a raw `value` with no
 * matching `<option>` silently breaks.
 */
export const VIP_TIER_FIELD_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'BRONZE', label: 'BRONZE' },
  { value: 'SILVER', label: 'SILVER' },
  { value: 'GOLD', label: 'GOLD' },
];
export const isVipTier = (value: string): value is 'BRONZE' | 'SILVER' | 'GOLD' =>
  value === 'BRONZE' || value === 'SILVER' || value === 'GOLD';

export function Field({
  normalize,
  suggestName = false,
  optionalPhone = false,
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
}: {
  normalize?: (value: string) => string;
  suggestName?: boolean;
  optionalPhone?: boolean;
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const isPhone = optionalPhone || /mobile|contact|landline/i.test(label);
  const isName =
    suggestName || /^(?:first|last|middle|printed|primary|secondary) name$/i.test(label);
  // HumanInput owns contact/name errors; only date validation belongs here.
  // A required field left empty always explains itself, whatever its kind.
  const validator = /birth date/i.test(label) ? birthDateSchema : null;
  const empty = touched && required && value === '';
  const error =
    empty ||
    Boolean(
      touched && validator && !validator.safeParse(value).success && (required || value !== ''),
    );
  const errorMessage = empty
    ? 'This field cannot be left empty.'
    : 'Enter a valid past birth date.';
  return (
    <label className={styles.filterLabel} htmlFor={id}>
      <span>{label}</span>
      <NormalizedInput
        id={id}
        landline={/landline/i.test(label)}
        normalize={normalize}
        suggestName={isName}
        type={isPhone ? 'tel' : /email/i.test(label) ? 'email' : type}
        inputMode={isPhone ? 'tel' : undefined}
        value={value}
        placeholder={placeholder}
        required={required}
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
      />
      {error ? (
        <small id={`${id}-error`} role="alert">
          {errorMessage}
        </small>
      ) : null}
    </label>
  );
}

export function DateField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const todayValue = new Date().toISOString().slice(0, 10);
  const empty = touched && required && value === '';
  const error =
    empty || (touched && (required || value !== '') && !birthDateSchema.safeParse(value).success);
  return (
    <label className={styles.filterLabel} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="date"
        aria-invalid={error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        max={todayValue}
        required={required}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
      />
      {error ? (
        <small id={`${id}-error`} role="alert">
          {empty
            ? 'This field cannot be left empty.'
            : 'Enter a valid past birth date in YYYY-MM-DD format.'}
        </small>
      ) : null}
    </label>
  );
}

export function HolderFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: ApplicationHolder;
  onChange: (value: ApplicationHolder) => void;
}) {
  const set = (key: keyof ApplicationHolder, next: string) => onChange({ ...value, [key]: next });
  return (
    <fieldset className={styles.panel}>
      <legend className={styles.panelTitle}>{title}</legend>
      <div className={styles.editorGrid}>
        <Field
          label="Last name"
          value={value.lastName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('lastName', v)}
          onChange={(v) => set('lastName', v)}
          required
        />
        <Field
          label="First name"
          value={value.firstName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('firstName', v)}
          onChange={(v) => set('firstName', v)}
          required
        />
        <Field
          label="Middle name"
          value={value.middleName ?? ''}
          suggestName
          normalize={(v) => normalizeLiveHumanField('middleName', v)}
          onChange={(v) => set('middleName', v)}
        />
        <Field
          label="Suffix"
          value={value.suffix ?? ''}
          normalize={(v) => normalizeLiveHumanField('suffix', v)}
          onChange={(v) => set('suffix', v)}
        />
        <DateField
          label="Birth date"
          value={value.birthDate}
          onChange={(v) => set('birthDate', v)}
          required
        />
        <Field
          label="Sex"
          value={value.sex ?? ''}
          normalize={(v) => normalizeLiveHumanField('sex', v)}
          onChange={(v) => set('sex', v)}
        />
        <Field
          label="Citizenship"
          value={value.citizenship ?? ''}
          normalize={(v) => normalizeLiveHumanField('citizenship', v)}
          onChange={(v) => set('citizenship', v)}
        />
        <Field
          label="Civil status"
          value={value.civilStatus ?? ''}
          normalize={(v) => normalizeLiveHumanField('civilStatus', v)}
          onChange={(v) => set('civilStatus', v)}
        />
        <Field
          label="Permanent address line 1"
          value={value.permanentAddressLine1}
          normalize={(v) => normalizeLiveHumanField('permanentAddressLine1', v)}
          onChange={(v) => set('permanentAddressLine1', v)}
          required
        />
        <Field
          label="Permanent address line 2"
          value={value.permanentAddressLine2 ?? ''}
          normalize={(v) => normalizeLiveHumanField('permanentAddressLine2', v)}
          onChange={(v) => set('permanentAddressLine2', v)}
        />
        {/*
          Province -> city/municipality -> barangay, verified against the official
          PSGC hierarchy. Street lines above and postal code below stay plain text:
          those are the person's own words, these three are the authority's.

          A legacy record with free-text geography and no codes renders exactly as
          stored and is labelled unverified; nothing here invents a code for it.
        */}
        <GeographicAddressFields
          idPrefix={`${value.holderType.toLowerCase()}-${title.replace(/\W+/g, '-')}`}
          value={value}
          onChange={(next) => onChange({ ...value, ...next })}
        />
        <Field
          label="Postal code"
          value={value.postalCode ?? ''}
          normalize={(v) => normalizeLiveHumanField('postalCode', v)}
          onChange={(v) => set('postalCode', v)}
        />
        <Field
          label="Landline"
          optionalPhone
          value={value.landline ?? ''}
          normalize={(v) => normalizeLiveHumanField('landline', v)}
          onChange={(v) => set('landline', v)}
        />
        <Field
          label="Mobile"
          value={value.mobile}
          normalize={(v) => normalizeLiveHumanField('mobile', v)}
          onChange={(v) => set('mobile', v)}
          required
        />
        <Field
          label="Email"
          value={value.email}
          normalize={(v) => normalizeLiveHumanField('email', v)}
          onChange={(v) => set('email', v)}
          type="email"
          required
        />
        <Field
          label="TIN"
          value={value.tinNumber ?? ''}
          normalize={(v) => normalizeLiveHumanField('tinNumber', v)}
          onChange={(v) => set('tinNumber', v)}
        />
        <Field
          label="Occupation / business"
          value={value.occupationBusinessName ?? ''}
          normalize={(v) => normalizeLiveHumanField('occupationBusinessName', v)}
          onChange={(v) => set('occupationBusinessName', v)}
        />
        <Field
          label="Office / business address"
          value={value.officeBusinessAddress ?? ''}
          normalize={(v) => normalizeLiveHumanField('officeBusinessAddress', v)}
          onChange={(v) => set('officeBusinessAddress', v)}
        />
        <Field
          label="Business / industry"
          value={value.businessIndustry ?? ''}
          normalize={(v) => normalizeLiveHumanField('businessIndustry', v)}
          onChange={(v) => set('businessIndustry', v)}
        />
        <Field
          label="Employed position"
          value={value.employedPosition ?? ''}
          normalize={(v) => normalizeLiveHumanField('employedPosition', v)}
          onChange={(v) => set('employedPosition', v)}
        />
        <Field
          label="Printed name"
          value={value.printedName}
          suggestName
          normalize={(v) => normalizeLiveHumanField('printedName', v)}
          onChange={(v) => set('printedName', v)}
          required
        />
      </div>
    </fieldset>
  );
}

/** Fixed queue page size. The server also enforces its own max (200). */
export const QUEUE_PAGE_SIZE = 10;

/**
 * Application status badge tones. Stated explicitly per status instead of
 * relying on the shared fallback: cancelled and rejected read danger,
 * submitted reads in progress, approved reads success, drafts stay neutral.
 */
export const APPLICATION_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'danger'> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'danger',
};

/**
 * Recommender fields with explicit human labels (never generated from keys),
 * so renaming a label cannot silently rename the payload field.
 */
export function RecommenderFields({
  meta,
  onChange,
}: {
  meta: {
    salesManagerName: string;
    vipRecommenderName: string;
    recommenderContact: string;
    recommenderEmail: string;
    vipReferrer: string;
    acknowledgedAt: string;
  };
  onChange: (key: keyof typeof meta, value: string) => void;
}) {
  const fields = [
    { key: 'salesManagerName', label: 'Sales Manager Name', optionalPhone: false },
    { key: 'vipRecommenderName', label: 'VIP Recommender Name', optionalPhone: false },
    { key: 'recommenderContact', label: 'Recommender Contact', optionalPhone: true },
    { key: 'recommenderEmail', label: 'Recommender Email', optionalPhone: false },
    { key: 'vipReferrer', label: 'VIP Referrer', optionalPhone: false },
    { key: 'acknowledgedAt', label: 'Acknowledged At', optionalPhone: false },
  ] as const;
  return (
    <>
      {fields.map(({ key, label, optionalPhone }) => (
        <Field
          key={key}
          label={label}
          value={meta[key]}
          type={key === 'acknowledgedAt' ? 'date' : 'text'}
          normalize={(v) => normalizeLiveHumanField(key, v)}
          optionalPhone={optionalPhone}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </>
  );
}

