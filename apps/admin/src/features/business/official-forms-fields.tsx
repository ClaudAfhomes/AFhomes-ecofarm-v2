/**

 * Official-form field kit.

 *

 * Shared inputs, labels, tier vocabulary, and paging constants for the customer-application and reservation-agreement editors.

 */

import { HumanInput as NormalizedInput } from '../../lib/HumanInput';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApplicationHolder, GenealogyNode } from '@afhomes/contracts';
import {
  birthDateSchema,
  holderBirthDateSchema,
  OLDEST_HOLDER_AGE,
  CIVIL_STATUS_OPTIONS,
  SEX_OPTIONS,
  SUFFIX_OPTIONS,
  tinNumberSchema,
} from '@afhomes/contracts';
import type { ZodType } from 'zod';
import { Select } from '@afhomes/ui';
import styles from './OfficialFormsPages.module.css';
import {
  filterBusinessTextInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterTinInput,
  normalizeLiveHumanField,
} from '../../lib/normalize';
import { GeographicAddressFields } from '../address/GeographicAddressFields';
import { getGenealogy } from '../genealogy/services';

export const today = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
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

/** Live filter for contact numbers: strip letters outright. */
export const filterContactInput = (value: string): string => value.replace(/\p{L}/gu, '');

/** One message for every way a holder birth date can be wrong. */
const BIRTH_DATE_MESSAGE = `Enter a real past birth date, and an age of ${OLDEST_HOLDER_AGE} or less.`;

/**
 * Reservation-holder live filter, mirroring the reservation server rules.
 * Address stays UPPERCASE (server `upperAddress`); names preserve typing;
 * TIN keeps digits/dashes; emails lowercase; contacts strip letters.
 */
export const filterReservationFieldInput = (key: string, value: string): string => {
  if (key === 'address') return value.toUpperCase();
  if (key === 'tinNumber') return filterTinInput(value);
  if (key === 'email') return value.toLowerCase();
  if (key === 'contactNumber') return filterContactInput(value);
  return normalizeLiveHumanField(key, value);
};

export function Field({
  normalize,
  suggestName = false,
  optionalPhone = false,
  validate = null,
  validateMessage,
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
  /** Extra contract check on top of the built-in kind detection (e.g. TIN). */
  validate?: ZodType | null;
  validateMessage?: string;
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
  const validator = /birth date/i.test(label) ? birthDateSchema : validate;
  const empty = touched && required && value === '';
  const error =
    empty ||
    Boolean(
      touched && validator && !validator.safeParse(value).success && (required || value !== ''),
    );
  const errorMessage = empty
    ? 'This field cannot be left empty.'
    : (validateMessage ?? 'Enter a valid past birth date.');
  return (
    <label className={styles.filterLabel} htmlFor={id}>
      <span>{label}</span>
      <NormalizedInput
        id={id}
        landline={/landline/i.test(label)}
        normalize={normalize}
        suggestName={isName}
        contractSchema={validate}
        contractMessage={validateMessage}
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
          // Block letters in phone fields at keystroke, like HumanInput.
          if (isPhone && /\p{L}/u.test(event.target.value)) return;
          // Emails stay lowercase while typing.
          if (/email/i.test(label) && event.target.value !== event.target.value.toLowerCase()) {
            event.target.value = event.target.value.toLowerCase();
          }
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

/**
 * A closed-choice field for the fixed pick-lists (Suffix, Sex, Citizenship,
 * Civil status). A dropdown rather than a text box: the value is a closed set,
 * so free typing could only ever produce a value the server refuses.
 */
function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className={styles.filterLabel}>
      <span>{label}</span>
      <Select
        aria-label={label}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        options={options}
      />
    </label>
  );
}

/**
 * The pick-list options plus the honest empty choice.
 *
 * `emptyLabel` is per-field because the wording is a domain word, not a
 * generic: a holder with no suffix has NONE, which is not the same statement
 * as a record where the field was never filled in.
 */
const choiceOptions = (values: readonly string[], emptyLabel = 'Not specified') => [
  { value: '', label: emptyLabel },
  ...values.map((value) => ({ value, label: value })),
];

/**
 * A stored value that is no longer offered, kept visible.
 *
 * A `<select>` whose `value` matches no `<option>` silently DISPLAYS the first
 * option while still holding the old value, so the form would look like
 * "None" and submit something else. Re-surfacing the retired value keeps the
 * record honest: the operator sees what is actually stored and changes it
 * deliberately. The contract still refuses it on write, so it cannot persist.
 */
const withStoredValue = (
  options: { value: string; label: string }[],
  stored: string | undefined,
) =>
  stored && !options.some((option) => option.value === stored)
    ? [...options, { value: stored, label: `${stored} (retired)` }]
    : options;

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
  const invalid = touched && (required || value !== '') && !holderBirthDateSchema.safeParse(value).success;
  return (
    <label className={styles.filterLabel} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="date"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        value={value}
        max={todayValue}
        required={required}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          setTouched(true);
          onChange(event.target.value);
        }}
      />
      {invalid ? (
        <small id={`${id}-error`} role="alert">
          {empty ? 'This field cannot be left empty.' : BIRTH_DATE_MESSAGE}
        </small>
      ) : null}
    </label>
  );
}

/**
 * Live filter for a free-text business field.
 *
 * Keeps whatever casing convention the field already used (`normalizeLiveHumanField`
 * is the shared rule) and only removes characters no business name contains, so
 * this changes what may be typed - never how an existing field renders.
 */
const businessText =
  (key: string) =>
  (value: string): string =>
    filterBusinessTextInput(normalizeLiveHumanField(key, value));

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
          normalize={filterHolderNameInput}
          onChange={(v) => set('lastName', v)}
          required
        />
        <Field
          label="First name"
          value={value.firstName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('firstName', v)}
          required
        />
        <Field
          label="Middle name"
          value={value.middleName ?? ''}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('middleName', v)}
        />
        <SelectField
          label="Suffix"
          value={value.suffix ?? ''}
          onChange={(v) => set('suffix', v)}
          options={choiceOptions(SUFFIX_OPTIONS, 'None')}
        />
        <DateField
          label="Birth date"
          value={value.birthDate}
          onChange={(v) => set('birthDate', v)}
          required
        />
        <SelectField
          label="Sex"
          value={value.sex ?? ''}
          onChange={(v) => set('sex', v)}
          options={withStoredValue(choiceOptions(SEX_OPTIONS), value.sex)}
        />
        {/*
          Typed, not chosen: the closed citizenship set covers the workbook
          template, not the people who apply. Validated with the same
          nationality-name rule the contract enforces.
        */}
        <Field
          label="Citizenship"
          value={value.citizenship ?? ''}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('citizenship', v)}
        />
        <SelectField
          label="Civil status"
          value={value.civilStatus ?? ''}
          onChange={(v) => set('civilStatus', v)}
          options={withStoredValue(choiceOptions(CIVIL_STATUS_OPTIONS), value.civilStatus)}
        />
        <Field
          label="Permanent address line 1"
          value={value.permanentAddressLine1}
          normalize={filterHolderAddressInput}
          onChange={(v) => set('permanentAddressLine1', v)}
          required
        />
        <Field
          label="Permanent address line 2"
          value={value.permanentAddressLine2 ?? ''}
          normalize={filterHolderAddressInput}
          onChange={(v) => set('permanentAddressLine2', v)}
        />
        {/*
          Province -> city/municipality -> barangay, verified against the official
          PSGC hierarchy. Street lines above stay plain text: those are the
          person's own words, these three are the authority's.

          A legacy record with free-text geography and no codes renders exactly as
          stored and is labelled unverified; nothing here invents a code for it.
        */}
        <GeographicAddressFields
          idPrefix={`${value.holderType.toLowerCase()}-${title.replace(/\W+/g, '-')}`}
          value={value}
          onChange={(next) => onChange({ ...value, ...next })}
        />
        {/*
          The postal code belongs to the chosen city / municipality, so it is
          FILLED from the authority's own record and rendered read-only: there
          is no typed path that could contradict the address. A legacy record
          keeps its stored value; the server re-derives it on save whenever the
          provider publishes one.
        */}
        <label className={styles.filterLabel} htmlFor={`${value.holderType}-postal-code`}>
          <span>Postal code</span>
          <input
            id={`${value.holderType}-postal-code`}
            type="text"
            readOnly
            aria-readonly="true"
            aria-label="Postal code"
            placeholder="Filled from the city / municipality"
            value={value.postalCode ?? ''}
            onFocus={(event) => event.currentTarget.select()}
          />
          {value.cityMunicipalityCode && !value.postalCode ? (
            <small>No published code. Leave blank.</small>
          ) : null}
        </label>
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
          normalize={filterTinInput}
          validate={tinNumberSchema}
          validateMessage="Use a 9-digit TIN, for example 123-456-789."
          onChange={(v) => set('tinNumber', v)}
        />
        <Field
          label="Occupation / business"
          value={value.occupationBusinessName ?? ''}
          normalize={businessText('occupationBusinessName')}
          onChange={(v) => set('occupationBusinessName', v)}
        />
        <Field
          label="Office / business address"
          value={value.officeBusinessAddress ?? ''}
          normalize={businessText('officeBusinessAddress')}
          onChange={(v) => set('officeBusinessAddress', v)}
        />
        <Field
          label="Business / industry"
          value={value.businessIndustry ?? ''}
          normalize={businessText('businessIndustry')}
          onChange={(v) => set('businessIndustry', v)}
        />
        <Field
          label="Employed position"
          value={value.employedPosition ?? ''}
          normalize={businessText('employedPosition')}
          onChange={(v) => set('employedPosition', v)}
        />
        <Field
          label="Printed name"
          value={value.printedName}
          suggestName
          normalize={filterHolderNameInput}
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
export type ReferralChainIds = {
  svdStaffId: string;
  ssmStaffId: string;
  smStaffId: string;
  referrerStaffId: string;
};

const CHAIN_LEVELS = [
  { key: 'svdStaffId', label: 'SVD', role: 'vice_director' },
  { key: 'ssmStaffId', label: 'SSM', role: 'senior_sales_manager' },
  { key: 'smStaffId', label: 'SM', role: 'sales_manager' },
  { key: 'referrerStaffId', label: 'Referrer', role: 'ost' },
] as const;

/**
 * Dropdown candidates for one chain level: active sellers of the level's
 * role, limited to the selected upline's downline when one is chosen.
 *
 * Ancestry is walked from the genealogy's own upline links with a depth cap,
 * so a cycle stops contributing rather than looping. Inactive staff can never
 * be named; a missing upline means "no constraint", never "no options".
 */
export function chainOptions(
  nodes: readonly GenealogyNode[],
  role: string,
  aboveStaffId: string | null,
): GenealogyNode[] {
  const pool = nodes.filter(
    (node) =>
      node.role === role &&
      node.status === 'active' &&
      (node.ostStatus === null || node.ostStatus === 'active'),
  );
  if (!aboveStaffId) return pool;
  const parent = new Map(nodes.map((node) => [node.staffId, node.uplineStaffId]));
  return pool.filter((node) => {
    let current = parent.get(node.staffId) ?? null;
    const seen = new Set([node.staffId]);
    for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
      if (current === aboveStaffId) return true;
      seen.add(current);
      current = parent.get(current) ?? null;
    }
    return false;
  });
}

export function RecommenderFields({
  meta,
  chainNames,
  onChange,
  onChain,
}: {
  meta: {
    svdStaffId: string;
    ssmStaffId: string;
    smStaffId: string;
    referrerStaffId: string;
    vipRecommenderName: string;
    recommenderContact: string;
    recommenderEmail: string;
    acknowledgedAt: string;
  };
  /** Snapshot names for selections the list no longer contains. */
  chainNames: Record<string, string>;
  onChange: (
    key: 'vipRecommenderName' | 'recommenderContact' | 'recommenderEmail' | 'acknowledgedAt',
    value: string,
  ) => void;
  onChain: (next: ReferralChainIds) => void;
}) {
  // The Organization chain, read live: every dropdown names a real, active
  // seller, and each level is limited to the chosen upline's downline. The
  // browser never invents linkage - the server re-resolves every id and
  // refuses a chain that disagrees with the genealogy.
  const chain = useQuery({
    queryKey: ['genealogy', 'referral-chain'],
    queryFn: getGenealogy,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const nodes = chain.data ?? [];
  // The nearest selected level above each dropdown: gaps stay selectable, so
  // an SM under an SVD with no SSM named still lists that SVD's downline.
  const aboveFor = (index: number): string | null => {
    if (index <= 0) return null;
    for (let up = index - 1; up >= 0; up -= 1) {
      const selected = meta[CHAIN_LEVELS[up]!.key];
      if (selected) return selected;
    }
    return null;
  };
  const optionsFor = (index: number) => {
    const level = CHAIN_LEVELS[index]!;
    const options = chainOptions(nodes, level.role, aboveFor(index)).map((node) => ({
      value: node.staffId,
      label: node.fullName,
    }));
    // A stored selection the list no longer contains (a departure, or a chain
    // outside the viewer's own scope) stays visible and submittable; the
    // server refuses it at write time if the staff is no longer eligible.
    const selected = meta[level.key];
    if (selected && !options.some((option) => option.value === selected))
      options.unshift({
        value: selected,
        label: `${chainNames[selected] ?? 'Selected member'} (unavailable)`,
      });
    return [{ value: '', label: 'Not specified' }, ...options];
  };
  const setChain = (key: keyof ReferralChainIds, next: string) => {
    const order: (keyof ReferralChainIds)[] = [
      'svdStaffId',
      'ssmStaffId',
      'smStaffId',
      'referrerStaffId',
    ];
    // A changed upline clears everything below it: a downline chosen under a
    // different leader would otherwise silently disagree with the new one.
    const cleared: Partial<ReferralChainIds> = {};
    for (const later of order.slice(order.indexOf(key) + 1)) cleared[later] = '';
    onChain({ ...pickChain(meta), [key]: next, ...cleared });
  };
  const fields = [
    { key: 'vipRecommenderName', label: 'VIP Recommender Name', optionalPhone: false, name: true },
    { key: 'recommenderContact', label: 'Recommender Contact', optionalPhone: true, name: false },
    { key: 'recommenderEmail', label: 'Recommender Email', optionalPhone: false, name: false },
    { key: 'acknowledgedAt', label: 'Acknowledged At', optionalPhone: false, name: false },
  ] as const;
  return (
    <>
      <div className={styles.subGroup} style={{ gridColumn: '1 / -1' }}>
        <p className={styles.subGroupTitle}>Organization chain (staff linkage)</p>
        <p className={styles.hint}>Referrer must be active OST staff.</p>
      </div>
      {CHAIN_LEVELS.map((level, index) => (
        <label key={level.key} className={styles.filterLabel}>
          <span>{level.label}</span>
          <Select
            aria-label={level.label}
            value={meta[level.key]}
            disabled={chain.isPending}
            onChange={(event) => setChain(level.key, event.target.value)}
            options={optionsFor(index)}
          />
        </label>
      ))}
      {chain.isError ? <p role="status">Chain list unavailable. Retry.</p> : null}
      <div className={styles.subGroup} style={{ gridColumn: '1 / -1' }}>
        <p className={styles.subGroupTitle}>VIP recommender (free text)</p>
        <p className={styles.hint}>Name, contact and email are typed.</p>
      </div>
      {fields.map(({ key, label, optionalPhone, name }) => (
        <Field
          key={key}
          label={label}
          value={meta[key]}
          type={key === 'acknowledgedAt' ? 'date' : 'text'}
          normalize={
            key === 'recommenderEmail'
              ? (v) => v.toLowerCase()
              : name
                ? filterHolderNameInput
                : (v) => normalizeLiveHumanField(key, v)
          }
          optionalPhone={optionalPhone}
          onChange={(v) => onChange(key, v)}
        />
      ))}
    </>
  );
}

/** The four chain ids out of a meta object. */
function pickChain(meta: {
  svdStaffId: string;
  ssmStaffId: string;
  smStaffId: string;
  referrerStaffId: string;
}): ReferralChainIds {
  return {
    svdStaffId: meta.svdStaffId,
    ssmStaffId: meta.ssmStaffId,
    smStaffId: meta.smStaffId,
    referrerStaffId: meta.referrerStaffId,
  };
}
