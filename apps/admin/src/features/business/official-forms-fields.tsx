/**

 * Official-form field kit.

 *

 * Shared inputs, labels, tier vocabulary, and paging constants for the customer-application and reservation-agreement editors.

 */

import { HumanInput as NormalizedInput } from '../../lib/HumanInput';
import { useId, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApplicationHolder, Customer, GenealogyNode } from '@afhomes/contracts';
import {
  applicationHolderSchema,
  birthDateSchema,
  holderBirthDateSchema,
  OLDEST_HOLDER_AGE,
  CIVIL_STATUS_OPTIONS,
  SEX_OPTIONS,
  tinNumberSchema,
  optionalContactNumberSchema,
  aaNumberSchema,
  SELLER_OF_RECORD_ROLE,
  canCreateVipSale,
  mustNameSellerOfRecord,
} from '@afhomes/contracts';
import type { ZodType } from 'zod';
import { Alert, Button, Select } from '@afhomes/ui';
import { ApplicationChoiceCards } from './ApplicationChoiceCards';
import { resolveApplicationNetwork } from './application-network';
import styles from './OfficialFormsPages.module.css';
import v4 from './CustomerApplicationV4.module.css';
import {
  filterBusinessTextInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterTinInput,
  normalizeLiveHumanField,
} from '../../lib/normalize';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { GeographicAddressFields } from '../address/GeographicAddressFields';
import {
  getGenealogy,
  getOstMemberContacts,
  resolveAaNumber,
  getAccreditationNumbers,
  type ResolvedAaMember,
} from '../genealogy/services';

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
  raNumber: '',
  printedName: '',
});

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** Case/punctuation-insensitive match against a closed option list; `undefined`
 * when nothing matches, rather than guessing or crashing an unmatched <option>. */
function matchOption<T extends string>(
  value: string | null | undefined,
  options: readonly T[],
): T | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  return options.find((option) => option.toLowerCase().replace(/\.$/, '') === normalized);
}

/**
 * Base holder prefill from the customer's OWN profile - available for every
 * customer, imported or manually created. A committed workbook import (see
 * `getCustomerImportPrefill`) layers richer/additional fields on top of this
 * when one exists; this function never requires one. Anything ambiguous
 * (free-text gender/civil status that doesn't match this form's closed
 * options) is left out rather than guessed, per the "never invent
 * information" rule - the field just stays blank and editable.
 */
export function customerProfileToHolder(customer: Customer): Partial<ApplicationHolder> {
  const address =
    customer.address && typeof customer.address === 'object'
      ? (customer.address as Record<string, unknown>)
      : {};
  const printedName = [customer.firstName, customer.middleName, customer.lastName, customer.suffix]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
  const entries: Partial<ApplicationHolder> = {
    firstName: text(customer.firstName),
    middleName: text(customer.middleName),
    lastName: text(customer.lastName),
    suffix: text(customer.suffix),
    birthDate: text(customer.dateOfBirth),
    sex: matchOption(customer.gender, SEX_OPTIONS),
    citizenship: text(customer.citizenship),
    civilStatus: matchOption(customer.civilStatus, CIVIL_STATUS_OPTIONS),
    permanentAddressLine1: text(address.line1),
    permanentAddressLine2: text(address.line2),
    cityMunicipality: text(address.city),
    province: text(address.province),
    barangay: text(address.barangay),
    postalCode: text(address.postalCode),
    landline: text(customer.landline),
    mobile: text(customer.phone),
    email: text(customer.email),
    tinNumber: text(customer.tinNumber),
    raNumber: text(customer.raNumber),
    occupationBusinessName: text(customer.occupationBusinessName),
    officeBusinessAddress: text(customer.officeBusinessAddress),
    employedPosition: text(customer.employedPosition),
    printedName: printedName || undefined,
  };
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as Partial<ApplicationHolder>;
}
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

/** Live filter for contact numbers: digits only, capped at the 11-digit
 * 09XXXXXXXXX mobile format (`contactNumber` is a required mobile field). */
export const filterContactInput = (value: string): string => value.replace(/\D/g, '').slice(0, 11);

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
  list,
  readOnly = false,
  disabled = false,
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
  list?: string;
  /** Show the stored value but refuse edits (e.g. a locked TIN). */
  readOnly?: boolean;
  disabled?: boolean;
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
    <label className={`${styles.filterLabel} ${v4.field}`} htmlFor={id}>
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
        list={list}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
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
export function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
  cards = false,
  compact = false,
  appearance = 'tiles',
}: {
  appearance?: 'tiles' | 'inline' | 'civil';
  cards?: boolean;
  /** Dense, label-only tiles (see `ApplicationChoiceCards`'s own `compact`) -
   * for a closed set of short choices (e.g. Civil status) where the roomier
   * icon+description card grid would be mostly empty space. */
  compact?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  if (cards)
    return (
      <ApplicationChoiceCards
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        compact={compact}
        appearance={appearance}
      />
    );
  return (
    <label className={`${styles.filterLabel} ${v4.field}`}>
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
export const withStoredValue = (
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
  const invalid =
    touched && (required || value !== '') && !holderBirthDateSchema.safeParse(value).success;
  return (
    <label className={`${styles.filterLabel} ${v4.field}`} htmlFor={id}>
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
  sectioned = false,
  tabbed = false,
  initialSection = 'personal',
  section,
  onSectionChange,
}: {
  sectioned?: boolean;
  tabbed?: boolean;
  initialSection?: string;
  section?: string;
  onSectionChange?: (section: string) => void;
  title: string;
  value: ApplicationHolder;
  onChange: (value: ApplicationHolder) => void;
}) {
  const [localSection, setLocalSection] = useState(
    initialSection === 'identity' ? 'personal' : initialSection,
  );
  const activeSection = section ?? localSection;
  const setActiveSection = (next: string) => {
    if (section === undefined) setLocalSection(next);
    onSectionChange?.(next);
  };
  const tabs = [
    ['personal', 'Personal'],
    ['address', 'Address'],
    ['contact', 'Contact'],
    ['work', 'Additional'],
  ];
  const tabId = useId();
  const visible = (section: string) =>
    !tabbed || activeSection === (section === 'identity' ? 'personal' : section);
  const set = (key: keyof ApplicationHolder, next: string) => onChange({ ...value, [key]: next });
  const identityFields = (
    <>
      <SelectField
        cards={sectioned}
        appearance={tabbed ? 'inline' : 'tiles'}
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
        cards={sectioned}
        compact={sectioned}
        appearance={tabbed ? 'civil' : 'tiles'}
        label="Civil status"
        value={value.civilStatus ?? ''}
        onChange={(v) => set('civilStatus', v)}
        options={withStoredValue(choiceOptions(CIVIL_STATUS_OPTIONS), value.civilStatus)}
      />
    </>
  );

  return (
    <fieldset className={tabbed ? v4.holderBlock : styles.panel}>
      <legend className={tabbed ? v4.sr : styles.panelTitle}>{title}</legend>
      {tabbed ? (
        <div className={v4.minihead}>
          <h3>{value.holderType === 'PRIMARY' ? 'Primary cardholder' : 'Secondary cardholder'}</h3>
          <span className={v4.hintpill}>
            {value.holderType === 'PRIMARY' ? 'Required' : 'Gold - Optional'}
          </span>
        </div>
      ) : null}
      {tabbed ? (
        <div className={v4.sections} role="tablist" aria-label={`${title} detail sections`}>
          {tabs.map(([key, label], index) => (
            <button
              key={key}
              type="button"
              className={`${v4.sectiontab} ${activeSection === key ? v4.sel : ''}`}
              role="tab"
              id={`${tabId}-${key}-tab`}
              aria-selected={activeSection === key}
              aria-controls={`${value.holderType.toLowerCase()}-${key}`}
              tabIndex={activeSection === key ? 0 : -1}
              onClick={() => setActiveSection(key!)}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                setActiveSection(tabs[next]![0]!);
                document.getElementById(`${tabId}-${tabs[next]![0]}-tab`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className={
          tabbed ? v4.holderSections : sectioned ? styles.holderSections : styles.editorGrid
        }
      >
        <section
          id={`${value.holderType.toLowerCase()}-personal`}
          hidden={!visible('personal')}
          role={tabbed ? 'tabpanel' : undefined}
          aria-labelledby={tabbed ? `${tabId}-personal-tab` : undefined}
          className={
            tabbed ? v4.holderSection : sectioned ? styles.holderSection : styles.fieldContents
          }
        >
          {sectioned && !tabbed ? (
            <h3 tabIndex={-1} className={styles.subGroupTitle}>
              Personal
            </h3>
          ) : null}
          <div className={tabbed ? v4.grid2 : sectioned ? styles.editorGrid : styles.fieldContents}>
            <Field
              label="Prefix"
              value={value.prefix ?? ''}
              onChange={(v) => set('prefix', v.slice(0, 20))}
              placeholder="Optional - Mr., Ms., Dr."
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
            <Field
              label="Last name"
              value={value.lastName}
              suggestName
              normalize={filterHolderNameInput}
              onChange={(v) => set('lastName', v)}
              required
            />
            <Field
              label="Suffix"
              value={value.suffix ?? ''}
              placeholder="Optional suffix"
              onChange={(v) => set('suffix', v.slice(0, 20))}
            />
            <DateField
              label="Birth date"
              value={value.birthDate}
              onChange={(v) => set('birthDate', v)}
              required
            />
            {tabbed ? identityFields : null}
          </div>
        </section>
        <section
          id={`${value.holderType.toLowerCase()}-contact`}
          hidden={!visible('contact')}
          role={tabbed ? 'tabpanel' : undefined}
          aria-labelledby={tabbed ? `${tabId}-contact-tab` : undefined}
          className={
            tabbed ? v4.holderSection : sectioned ? styles.holderSection : styles.fieldContents
          }
        >
          {sectioned && !tabbed ? (
            <h3 tabIndex={-1} className={styles.subGroupTitle}>
              Contact
            </h3>
          ) : null}
          <div className={tabbed ? v4.grid2 : sectioned ? styles.editorGrid : styles.fieldContents}>
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
          </div>
        </section>
        <section
          id={`${value.holderType.toLowerCase()}-address`}
          hidden={!visible('address')}
          role={tabbed ? 'tabpanel' : undefined}
          aria-labelledby={tabbed ? `${tabId}-address-tab` : undefined}
          className={
            tabbed ? v4.holderSection : sectioned ? styles.holderSection : styles.fieldContents
          }
        >
          {sectioned && !tabbed ? (
            <h3 tabIndex={-1} className={styles.subGroupTitle}>
              Address
            </h3>
          ) : null}
          <div className={tabbed ? v4.grid2 : sectioned ? styles.editorGrid : styles.fieldContents}>
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
            <label
              className={`${styles.filterLabel} ${v4.field}`}
              htmlFor={`${value.holderType}-postal-code`}
            >
              <span>Postal code</span>
              <input
                id={`${value.holderType}-postal-code`}
                type="text"
                readOnly
                aria-readonly="true"
                aria-label="Postal code"
                placeholder="Filled from city"
                value={value.postalCode ?? ''}
                onFocus={(event) => event.currentTarget.select()}
              />
              {value.cityMunicipalityCode && !value.postalCode ? (
                <small>Postal reference needs review for this location.</small>
              ) : null}
            </label>
          </div>
        </section>
        {!tabbed ? (
          <section
            id={`${value.holderType.toLowerCase()}-identity`}
            className={
              tabbed ? v4.holderSection : sectioned ? styles.holderSection : styles.fieldContents
            }
          >
            {sectioned ? (
              <h3 tabIndex={-1} className={styles.subGroupTitle}>
                Identity
              </h3>
            ) : null}
            <div
              className={tabbed ? v4.grid2 : sectioned ? styles.editorGrid : styles.fieldContents}
            >
              {identityFields}
            </div>
          </section>
        ) : null}
        <section
          id={`${value.holderType.toLowerCase()}-work`}
          hidden={!visible('work')}
          role={tabbed ? 'tabpanel' : undefined}
          aria-labelledby={tabbed ? `${tabId}-work-tab` : undefined}
          className={
            tabbed ? v4.holderSection : sectioned ? styles.holderSection : styles.fieldContents
          }
        >
          {sectioned && !tabbed ? (
            <h3 tabIndex={-1} className={styles.subGroupTitle}>
              Additional Information
            </h3>
          ) : null}
          <div className={tabbed ? v4.grid2 : sectioned ? styles.editorGrid : styles.fieldContents}>
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
        </section>
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

/** Live filter for an AA number: letters/digits/dash only, uppercase, capped
 * at the schema's own max length. Matches both shapes `aaNumberSchema` accepts
 * (`AAI261000001` and `AA-XXXXXXXXXXXX`) without guessing which one is meant. */
export const filterAaNumberInput = (value: string): string =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 20);

const ROLE_LABEL: Record<GenealogyNode['role'], string> = {
  vice_director: 'SVD',
  senior_sales_manager: 'SSM',
  sales_manager: 'SM',
  ost: 'OST',
};

/**
 * One AA-number input that resolves to an accredited seller as the staff
 * member types: debounced the same ~300ms as every other live lookup in this
 * app, validated against the shared `aaNumberSchema` before a lookup is ever
 * sent, and cleared to `null` the instant the typed value stops being a
 * resolvable number - so a half-edited field can never leave a stale member
 * attached to the application.
 */
export function AaNumberField({
  label,
  hint,
  value,
  onChange,
  onResolved,
  disabled = false,
  compact = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  onResolved: (member: ResolvedAaMember | null) => void;
  disabled?: boolean;
  /** Terse "verified / not found" status only - no name, role or status
   * text. For a field whose own resolved details are never shown (e.g. the
   * Network step's Referrer, which the Network screen deliberately keeps to
   * a bare verified/invalid signal). */
  compact?: boolean;
}) {
  const suggestionsId = useId();
  const directory = useQuery({ queryKey: ['genealogy', 'referral-chain'], queryFn: getGenealogy });
  const ostIds = (directory.data ?? []).filter(n => n.role === 'ost' && n.status === 'active' && n.ostStatus === 'active').map(n => n.staffId);
  const numbers = useQuery({
    queryKey: ['aa-numbers', ostIds.slice().sort().join(',')],
    queryFn: () => getAccreditationNumbers(ostIds),
    enabled: ostIds.length > 0,
    staleTime: 300_000,
  });
  const debounced = useDebouncedValue(value, 300);
  const candidate = aaNumberSchema.safeParse(debounced);
  const candidateValue = candidate.success ? candidate.data : null;
  const resolved = useQuery({
    queryKey: ['aa-resolve', candidateValue],
    queryFn: () => resolveAaNumber(candidateValue!),
    enabled: Boolean(candidateValue),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Lifting an already-fetched result to the parent on settle, not mirroring
  // state on every render: the ref keeps the effect's dependency list honest
  // (candidateValue / fetch outcome only) without re-subscribing it to a new
  // `onResolved` closure every keystroke, the same trick `useDebouncedValue`
  // itself uses for `onSettled`.
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    onResolvedRef.current = onResolved;
  });
  useEffect(() => {
    // An empty or not-yet-valid number reports nothing - it leaves whatever
    // was already resolved (from a restored draft, or an earlier valid entry)
    // alone. Only a SETTLED lookup (found, not-found, or failed) is allowed to
    // change it: clearing on every keystroke would also wipe a chain restored
    // from a saved draft the instant this field mounts blank.
    if (!candidateValue) return;
    if (resolved.isSuccess) onResolvedRef.current(resolved.data.member);
    else if (resolved.isError) onResolvedRef.current(null);
  }, [candidateValue, resolved.isSuccess, resolved.isError, resolved.data]);

  const typed = value.trim().length > 0;
  const status =
    !typed || !candidateValue
      ? null
      : resolved.isFetching
        ? { tone: 'neutral' as const, text: 'Looking up member…' }
        : resolved.isError
          ? { tone: 'danger' as const, text: 'Could not look up this AA number. Try again.' }
          : resolved.data?.member
            ? {
                tone: 'success' as const,
                text: compact
                  ? '✓ Verified'
                  : `${resolved.data.member.fullName} · ${ROLE_LABEL[resolved.data.member.role]} · ${resolved.data.member.status}`,
              }
            : {
                tone: 'danger' as const,
                text: compact ? '✕ Not found' : 'No accredited member found for this AA number.',
              };

  return (
    <div className={styles.aaNumberField}>
      <Field
        label={label}
        list={suggestionsId}
        value={value}
        normalize={filterAaNumberInput}
        validate={typed ? aaNumberSchema : null}
        validateMessage="Use an AAI/AAO number with a valid month and sequence, or an existing AA number."
        onChange={onChange}
        disabled={disabled}
        placeholder="e.g. AAO26100001"
      />
      <datalist id={suggestionsId}>
        {(directory.data ?? []).filter(n => ostIds.includes(n.staffId) && numbers.data?.[n.staffId]?.startsWith('AAO')).map(n => (
          <option key={n.staffId} value={numbers.data![n.staffId] ?? undefined}>{n.fullName}</option>
        ))}
      </datalist>
      {hint ? <p className={v4.networkBrief}>{hint}</p> : null}
      {status ? (
        <p
          className={
            status.tone === 'success'
              ? v4.networkInlineOk
              : status.tone === 'danger'
                ? v4.networkInlineError
                : v4.networkBrief
          }
          role={status.tone === 'danger' ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Read-only SM / SSM / SVD upline for a resolved recommender, with each
 * level's own AA number. Nothing here is selectable: the chain is the
 * recommender's REAL, existing genealogy relationship (the same data the
 * dropdown-based chain used to ask a human to reassemble by hand), so letting
 * it be edited here could only ever introduce a chain that disagrees with the
 * database the server will re-derive commissions from.
 */
export function UplineChain({
  nodes,
  staffId,
  badge,
  leading,
  help,
}: {
  nodes: readonly GenealogyNode[];
  staffId: string | null;
  /** "✓ Same team verified" once both sides resolve and match, "Read only"
   * otherwise - the same distinction the reference's own badge makes. */
  badge?: string;
  /** The SM card (seller of record), rendered before the SSM/SVD cards. */
  leading?: ReactNode;
  help?: string;
}) {
  const byId = new Map(nodes.map((node) => [node.staffId, node]));
  const chain: GenealogyNode[] = [];
  const seen = new Set<string>();
  let current = staffId ? byId.get(staffId)?.uplineStaffId : null;
  while (current && !seen.has(current) && chain.length < 4) {
    const node = byId.get(current);
    if (!node) break;
    chain.push(node);
    seen.add(current);
    current = node.uplineStaffId;
  }
  const ids = chain.map((node) => node.staffId);
  const numbers = useQuery({
    queryKey: ['aa-numbers', ids.slice().sort().join(',')],
    queryFn: () => getAccreditationNumbers(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!staffId && !leading) return null;
  if (!chain.length && !leading)
    return (
      <section className={v4.sharedTeam} aria-label="Upline">
        <div className={v4.sharedTeamHead}>
          <div>
            <h3>Upline</h3>
            <p>This member has no recorded upline.</p>
          </div>
        </div>
      </section>
    );
  return (
    <section className={v4.sharedTeam} aria-label="SM / SSM / SVD upline">
      <div className={v4.sharedTeamHead}>
        <div>
          <h3>SM / SSM / SVD upline</h3>
          <p>{help ?? 'Automatically resolved from the existing sales genealogy.'}</p>
        </div>
        {badge ? <span className={v4.hintpill}>{badge}</span> : null}
      </div>
      <div className={v4.sharedTeamChain}>
        {leading}
        {chain.map((node) => (
          <div key={node.staffId}>
            <small>{ROLE_LABEL[node.role]}</small>
            <strong>
              {node.fullName}
              {numbers.isFetching ? (
                <span> · Looking up AAI…</span>
              ) : numbers.data?.[node.staffId] ? (
                <span> · {numbers.data[node.staffId]}</span>
              ) : (
                <span> · No AA number on file</span>
              )}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

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
  networkSelection,
  onNetworkError,
  seller,
}: {
  /** Seller of record (Customer Application only). An SM creator is the seller
   * and sees their own account read-only; any other permitted creator picks
   * the active SM here. UX only - the server re-validates. */
  seller?: {
    account: { id?: string; name?: string; roleSlug?: string; status?: string } | null | undefined;
    value: string;
    onChange: (staffId: string) => void;
  };
  /** New Customer Application only. The Network screen is a flat pair of AA
   * number inputs (no IST/OST classification - both Referrer and VIP
   * Recommender are always OST), so this is now just a mode flag. */
  networkSelection?: boolean;
  meta: {
    svdStaffId: string;
    ssmStaffId: string;
    smStaffId: string;
    referrerStaffId: string;
    vipRecommenderName: string;
    recommenderContact: string;
    recommenderEmail: string;
    acknowledgedAt: string;
    /** Typed text, kept so a reloaded draft shows what was entered. Neither
     * is submitted on its own: `referrerAaNumber` only ever resolves to
     * `referrerStaffId` (already on the wire); `recommenderAaNumber` IS also
     * submitted, transiently, so the server can re-verify the same-team rule
     * itself instead of trusting this screen's own check. */
    referrerAaNumber: string;
    recommenderAaNumber: string;
    /** Local only - never submitted. Needed alongside `referrerStaffId` to
     * compute the shared-team display and the client-side mismatch warning. */
    recommenderStaffId: string;
  };
  /** Snapshot names for selections the list no longer contains. */
  chainNames: Record<string, string>;
  onChange: (
    key:
      | 'vipRecommenderName'
      | 'recommenderContact'
      | 'recommenderEmail'
      | 'acknowledgedAt'
      | 'referrerAaNumber'
      | 'recommenderAaNumber'
      | 'recommenderStaffId',
    value: string,
  ) => void;
  onChain: (next: ReferralChainIds) => void;
  /** Client-side same-team feedback only (UX, not the security boundary):
   * lifted so the wizard can disable Next/Submit and list it among the
   * blockers, exactly like every other step check. The server re-verifies
   * independently before any write (`verifyReferrerRecommenderTeam`). */
  onNetworkError?: (message: string) => void;
}) {
  const [referrerError, setReferrerError] = useState('');
  const [recommenderError, setRecommenderError] = useState('');
  // The Organization chain, read live: every dropdown names a real, active
  // seller, and each level is limited to the chosen upline's downline. The
  // browser never invents linkage - the server re-resolves every id and
  // refuses a chain that disagrees with the genealogy.
  const chain = useQuery({
    queryKey: ['genealogy', 'referral-chain'],
    queryFn: getGenealogy,
    staleTime: networkSelection ? 0 : 60 * 60 * 1000,
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

  // Build options for a chain level, excluding the other recommender if set.
  const optionsFor = (index: number) => {
    const level = CHAIN_LEVELS[index]!;
    let options = chainOptions(nodes, level.role, aboveFor(index)).map((node) => ({
      value: node.staffId,
      label: node.fullName,
    }));

    // Mutual exclusion: Referrer (index 3) and VIP Recommender cannot be the same person.
    // When building Referrer options, exclude the VIP Recommender's staff ID if we can find it.
    const isReferrerLevel = level.key === 'referrerStaffId';

    if (isReferrerLevel && meta.vipRecommenderName) {
      // Find the staff ID for the selected VIP recommender by name
      const vipNode = nodes.find((n) => n.fullName === meta.vipRecommenderName && n.role === 'ost');
      if (vipNode) {
        options = options.filter((opt) => opt.value !== vipNode.staffId);
      }
    }

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

  // Build VIP recommender options, excluding the selected Referrer
  const vipRecommenderOptions = (() => {
    const baseOptions = [
      { value: '', label: 'Not specified' },
      ...chainOptions(nodes, 'ost', null).map((node) => ({
        value: node.fullName,
        label: node.fullName,
      })),
    ];
    // Exclude the selected Referrer if it's an OST staff member
    if (meta.referrerStaffId) {
      const referrerNode = nodes.find(
        (n) => n.staffId === meta.referrerStaffId && n.role === 'ost',
      );
      if (referrerNode) {
        return withStoredValue(
          baseOptions.filter((opt) => opt.value !== referrerNode.fullName),
          meta.vipRecommenderName,
        );
      }
    }
    return withStoredValue(baseOptions, meta.vipRecommenderName);
  })();

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

  // Fetch contact info for all 5 recommenders (SVD, SSM, SM, Referrer, VIP Recommender)
  const selectedOstStaffIds = [
    meta.svdStaffId,
    meta.ssmStaffId,
    meta.smStaffId,
    meta.referrerStaffId,
    // AA-number flow resolves the id directly; the dropdown flow still finds
    // it by name since that is all it ever had.
    meta.recommenderStaffId,
    ...(meta.vipRecommenderName
      ? nodes
          .filter((n) => n.fullName === meta.vipRecommenderName && n.role === 'ost')
          .map((n) => n.staffId)
      : []),
  ].filter(Boolean);

  const contactsQuery = useQuery({
    queryKey: ['ost-member-contacts', selectedOstStaffIds.sort().join(',')],
    queryFn: () => getOstMemberContacts(selectedOstStaffIds),
    enabled: selectedOstStaffIds.length > 0,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Both dropdowns ultimately depend on the genealogy chain too: the VIP
  // recommender's staff id (and so their email) only resolves once `nodes`
  // has loaded, so a chain still in flight must count as loading here as
  // well - otherwise the email dropdown would flash "No email available"
  // while genealogy is still resolving who the recommender even is.
  // `isFetching` (not `isPending`) is used for the contacts query itself:
  // `isPending` stays true even while it sits disabled with no recommender
  // chosen yet, which would spin the dropdowns forever with nothing to fetch.
  const contactsLoading = chain.isPending || contactsQuery.isFetching;

  // AA-number flow only: once the resolved recommender's own contact record
  // arrives, fill it in directly - there is nothing to pick between, so this
  // replaces the old "choose from a dropdown" step entirely.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (!networkSelection || !meta.recommenderStaffId) return;
    const record = contactsQuery.data?.[meta.recommenderStaffId];
    if (!record) return;
    onChangeRef.current('recommenderContact', record.phone ?? '');
    onChangeRef.current('recommenderEmail', record.email ?? '');
  }, [networkSelection, meta.recommenderStaffId, contactsQuery.data]);

  // Same-team check (client-side feedback only; the server re-verifies
  // independently before any write). Referrer and Recommender are both
  // always OST, so `resolveApplicationNetwork`'s generic chain walk is used
  // purely to compare each one's SVD/SSM/SM - never to reinterpret who the
  // referrer actually is.
  const referrerId = meta.referrerStaffId || null;
  const recommenderId = meta.recommenderStaffId || null;
  const teamErrorMessage = (() => {
    if (!referrerId || !recommenderId) return '';
    if (referrerId === recommenderId)
      return 'Referrer and VIP recommender must be different members.';
    try {
      const a = resolveApplicationNetwork(nodes, referrerId).chain;
      const b = resolveApplicationNetwork(nodes, recommenderId).chain;
      const same =
        a.svdStaffId === b.svdStaffId &&
        a.ssmStaffId === b.ssmStaffId &&
        a.smStaffId === b.smStaffId;
      return same
        ? ''
        : 'Not allowed: referrer and VIP recommender belong to different teams. Choose an AA number from the same authorized sales team.';
    } catch {
      return 'Network relationship could not be resolved. Refresh and try again.';
    }
  })();
  // The shared team panel keys off whichever side resolved, preferring the
  // recommender (matching the approved design) so something useful shows
  // even before a referrer is entered.
  const sharedTeamStaffId = recommenderId ?? referrerId;
  const onNetworkErrorRef = useRef(onNetworkError);
  useEffect(() => {
    onNetworkErrorRef.current = onNetworkError;
  });
  useEffect(() => {
    onNetworkErrorRef.current?.(networkSelection ? teamErrorMessage : '');
  }, [networkSelection, teamErrorMessage]);
  // Chain derivation for submission: SVD/SSM/SM always come from the shared
  // team (whichever side resolved); `referrerStaffId` is always the
  // referrer's OWN id, never reinterpreted from the chain walk above.
  // Seller of record. An SM creator is the seller; any other permitted creator
  // names the active SM, defaulting to the SM of the referrer's own team.
  const sellerAccount = seller?.account;
  const sellerIsCreator = Boolean(
    seller && canCreateVipSale(sellerAccount) && !mustNameSellerOfRecord(sellerAccount),
  );
  const sellerEditable = Boolean(
    seller && canCreateVipSale(sellerAccount) && mustNameSellerOfRecord(sellerAccount),
  );
  const sellerId = seller?.value ?? '';
  const teamSmId = (() => {
    if (!sharedTeamStaffId) return '';
    try {
      return resolveApplicationNetwork(nodes, sharedTeamStaffId).chain.smStaffId;
    } catch {
      return '';
    }
  })();
  const sellerTouched = useRef(false);
  const onSellerRef = useRef(seller?.onChange);
  useEffect(() => {
    onSellerRef.current = seller?.onChange;
  });
  useEffect(() => {
    if (!sellerEditable || sellerTouched.current) return;
    onSellerRef.current?.(teamSmId);
  }, [sellerEditable, teamSmId]);
  const smOptionsAll = chainOptions(nodes, SELLER_OF_RECORD_ROLE, null);
  const [sellerSearch, setSellerSearch] = useState('');
  const smIds = smOptionsAll.map((node) => node.staffId);
  const smNumbers = useQuery({
    queryKey: ['aa-numbers', 'sellers', smIds.slice().sort().join(',')],
    queryFn: () => getAccreditationNumbers(smIds),
    enabled: sellerEditable && smIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const ownNumber = useQuery({
    queryKey: ['aa-numbers', 'own', sellerAccount?.id ?? ''],
    queryFn: () => getAccreditationNumbers([sellerAccount!.id!]),
    enabled: sellerIsCreator && Boolean(sellerAccount?.id),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const smLabel = (node: GenealogyNode) =>
    smNumbers.data?.[node.staffId] ? `${node.fullName} · ${smNumbers.data[node.staffId]}` : node.fullName;
  const needle = sellerSearch.trim().toLowerCase();
  const smChoices = smOptionsAll.filter(
    (node) =>
      node.staffId === sellerId ||
      !needle ||
      smLabel(node).toLowerCase().includes(needle),
  );
  const sellerMismatch = sellerEditable && Boolean(sellerId && teamSmId && sellerId !== teamSmId);
  const sellerCard = sellerIsCreator ? (
    <div>
      <small>SM · seller of record</small>
      <strong>
        {sellerAccount?.name ?? 'Your account'}
        {ownNumber.data?.[sellerAccount?.id ?? ''] ? (
          <span> · {ownNumber.data[sellerAccount?.id ?? '']}</span>
        ) : null}
      </strong>
    </div>
  ) : sellerEditable ? (
    <div>
      <small>SM · seller of record</small>
      <input
        type="search"
        aria-label="Search Sales Managers"
        placeholder="Search by name or AAI number"
        value={sellerSearch}
        onChange={(event) => setSellerSearch(event.target.value)}
      />
      <Select
        aria-label="Seller of record"
        required
        value={sellerId}
        disabled={chain.isPending}
        onChange={(event) => {
          sellerTouched.current = true;
          seller!.onChange(event.target.value);
        }}
        options={[
          {
            value: '',
            label: chain.isError ? 'Sales Managers could not be loaded' : 'Select a Sales Manager',
          },
          ...smChoices.map((node) => ({ value: node.staffId, label: smLabel(node) })),
        ]}
      />
      {sellerMismatch ? (
        <p role="status" className={v4.networkBrief}>
          Selected SM is not the referrer&apos;s team SM.
        </p>
      ) : null}
    </div>
  ) : null;
  // The SM/SSM/SVD cards follow the SELECTED seller, not the referrer.
  const chainSubject = sellerEditable && sellerId ? sellerId : sharedTeamStaffId;
  useEffect(() => {
    if (!networkSelection) return;
    if (!chainSubject) {
      onChain({ svdStaffId: '', ssmStaffId: '', smStaffId: '', referrerStaffId: referrerId ?? '' });
      return;
    }
    try {
      const derived = resolveApplicationNetwork(nodes, chainSubject).chain;
      onChain({
        svdStaffId: derived.svdStaffId,
        ssmStaffId: derived.ssmStaffId,
        smStaffId: derived.smStaffId,
        referrerStaffId: referrerId ?? '',
      });
    } catch {
      // Left as-is; `teamErrorMessage` above already reports the same failure.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkSelection, chainSubject, referrerId, nodes.length]);

  // Build contact options from selected recommenders
  const contactOptions = contactsQuery.data
    ? Object.entries(contactsQuery.data).flatMap(([staffId, { phone }]) => {
        const opts: { value: string; label: string }[] = [];
        if (phone && optionalContactNumberSchema.safeParse(phone).success)
          opts.push({ value: phone, label: `${phone} (${chainNames[staffId] ?? 'Recommender'})` });
        return opts;
      })
    : [];

  // Recommender Email shows only the selected VIP recommender's email.
  const vipRecommenderStaffId = meta.vipRecommenderName
    ? nodes.find((n) => n.fullName === meta.vipRecommenderName && n.role === 'ost')?.staffId
    : undefined;
  const emailOptions =
    contactsQuery.data && vipRecommenderStaffId
      ? Object.entries(contactsQuery.data)
          .filter(([staffId]) => staffId === vipRecommenderStaffId)
          .flatMap(([, { email }]) =>
            email ? [{ value: email.toLowerCase(), label: email.toLowerCase() }] : [],
          )
      : [];

  // The dropdown must never offer "No contact"/"No email" while the fetch is
  // still in flight - only once it has actually settled, one way or another.
  const contactSelectOptions = contactsLoading
    ? [{ value: '', label: 'Loading contact numbers…' }]
    : contactsQuery.isError
      ? [{ value: '', label: 'Unable to load contact numbers' }]
      : contactOptions.length > 0
        ? [{ value: '', label: 'Select contact' }, ...contactOptions]
        : [{ value: '', label: 'No contact available' }];
  const emailSelectOptions = contactsLoading
    ? [{ value: '', label: 'Loading email…' }]
    : contactsQuery.isError
      ? [{ value: '', label: 'Unable to load email' }]
      : emailOptions.length > 0
        ? [{ value: '', label: 'Select email' }, ...emailOptions]
        : [{ value: '', label: 'No email available' }];

  const recommenderContact = meta.recommenderStaffId
    ? contactsQuery.data?.[meta.recommenderStaffId]
    : undefined;
  return (
    <>
      {networkSelection ? (
        <div className={`${v4.staffgrid} ${v4.networkInputGrid}`} style={{ gridColumn: '1 / -1' }}>
          <div>
            <div className={v4.minihead}>
              <h3>Referring member</h3>
              <span className={v4.tiny}>Optional · active OST</span>
            </div>
            <AaNumberField
              label="OST Referrer AA number"
              hint="Optional. Enter an active OST AAO number."
              compact
              value={meta.referrerAaNumber}
              onChange={(next) => {
                onChange('referrerAaNumber', next);
                setReferrerError('');
              }}
              onResolved={(member) => {
                if (!member) {
                  onChain({ ...pickChain(meta), referrerStaffId: '' });
                  setReferrerError('');
                  return;
                }
                if (member.role !== 'ost') {
                  onChain({ ...pickChain(meta), referrerStaffId: '' });
                  setReferrerError('Referrer must be an accredited OST member.');
                  return;
                }
                setReferrerError('');
                onChain({ ...pickChain(meta), referrerStaffId: member.staffId });
              }}
            />
            {referrerError ? <Alert variant="danger">{referrerError}</Alert> : null}
          </div>
          <div>
            <div className={v4.minihead}>
              <h3>VIP recommender</h3>
              <span className={v4.tiny}>Active OST</span>
            </div>
            <AaNumberField
              label="OST VIP recommender AA number"
              hint="Enter the VIP recommender AAO number to show their verified contact."
              value={meta.recommenderAaNumber}
              onChange={(next) => {
                onChange('recommenderAaNumber', next);
                setRecommenderError('');
              }}
              onResolved={(member) => {
                if (!member) {
                  onChange('recommenderStaffId', '');
                  onChange('vipRecommenderName', '');
                  onChange('recommenderContact', '');
                  onChange('recommenderEmail', '');
                  return;
                }
                if (member.role !== 'ost') {
                  onChange('recommenderStaffId', '');
                  setRecommenderError('The VIP recommender must be an accredited OST member.');
                  onChange('vipRecommenderName', '');
                  onChange('recommenderContact', '');
                  onChange('recommenderEmail', '');
                  return;
                }
                setRecommenderError('');
                onChange('recommenderStaffId', member.staffId);
                onChange('vipRecommenderName', member.fullName);
              }}
            />
            {recommenderError ? <Alert variant="danger">{recommenderError}</Alert> : null}
            {meta.recommenderStaffId && !recommenderError ? (
              <div className={`${v4.networkContact}`} aria-label="VIP recommender contact">
                <div className={v4.networkContactTitle}>
                  <strong>✓ {meta.vipRecommenderName}</strong>
                  <span className={v4.networkContactBadge}>Verified OST</span>
                </div>
                <div className={v4.networkContactDetails}>
                  <span>
                    <small>Mobile</small>
                    <b>{recommenderContact?.phone || meta.recommenderContact || 'Not on file'}</b>
                  </span>
                  <span>
                    <small>Email</small>
                    <b>{recommenderContact?.email || meta.recommenderEmail || 'Not on file'}</b>
                  </span>
                </div>
              </div>
            ) : null}
          </div>
          {teamErrorMessage ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Alert variant="danger">{teamErrorMessage}</Alert>
            </div>
          ) : null}
          {sharedTeamStaffId || sellerCard ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <UplineChain
                nodes={nodes}
                // SSM/SVD follow the seller of record (the SM creator, or the
                // picked SM); with neither, the referrer's team as before.
                staffId={
                  sellerIsCreator
                    ? (sellerAccount?.id ?? null)
                    : sellerEditable
                      ? sellerId || null
                      : sharedTeamStaffId
                }
                leading={sellerCard}
                help={
                  sellerEditable
                    ? 'Choose the active Sales Manager who is the seller of record. SSM and SVD follow the selected SM.'
                    : sellerIsCreator
                      ? 'You are the seller of record. SSM and SVD follow your own upline.'
                      : undefined
                }
                badge={
                  sellerEditable
                    ? 'Select SM'
                    : referrerId && recommenderId && !teamErrorMessage
                      ? '✓ Same team verified'
                      : 'Read only'
                }
              />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className={styles.subGroup} style={{ gridColumn: '1 / -1' }}>
            <p className={styles.subGroupTitle}>Organization chain (staff linkage)</p>
            <p className={styles.hint}>Referrer must be active OST staff.</p>
          </div>
          {sellerEditable ? (
            <div className={v4.sharedTeam} style={{ gridColumn: '1 / -1' }}>
              {sellerCard}
            </div>
          ) : null}
          {CHAIN_LEVELS.map((level, index) => (
            <label key={level.key} className={`${styles.filterLabel} ${v4.field}`}>
              <span>{level.label}</span>
              <Select
                aria-label={level.label}
                value={meta[level.key]}
                disabled={chain.isPending}
                loading={chain.isPending}
                onChange={(event) => setChain(level.key, event.target.value)}
                options={optionsFor(index)}
              />
            </label>
          ))}
          {chain.isError ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Button
                variant="secondary"
                loading={chain.isFetching}
                loadingLabel="Retrying…"
                onClick={() => void chain.refetch()}
              >
                Retry chain list
              </Button>
            </div>
          ) : null}
          <div className={styles.subGroup} style={{ gridColumn: '1 / -1' }}>
            <p className={styles.subGroupTitle}>VIP recommender</p>
            <p className={styles.hint}>
              Recommender is active OST staff. Select contact and email from the dropdowns below.
            </p>
          </div>
          <label className={`${styles.filterLabel} ${v4.field}`}>
            <span>VIP Recommender</span>
            <Select
              aria-label="VIP Recommender"
              value={meta.vipRecommenderName}
              disabled={chain.isPending}
              loading={chain.isPending}
              onChange={(event) => onChange('vipRecommenderName', event.target.value)}
              options={vipRecommenderOptions}
            />
          </label>
          {/* Recommender Contact - dropdown from selected recommenders */}
          <label className={`${styles.filterLabel} ${v4.field}`}>
            <span>Recommender Contact</span>
            <Select
              aria-label="Recommender Contact"
              value={meta.recommenderContact}
              disabled={contactsLoading}
              loading={contactsLoading}
              onChange={(event) => onChange('recommenderContact', event.target.value)}
              options={contactSelectOptions}
            />
          </label>
          {/* Recommender Email - dropdown from selected recommenders */}
          <label className={`${styles.filterLabel} ${v4.field}`}>
            <span>Recommender Email</span>
            <Select
              aria-label="Recommender Email"
              value={meta.recommenderEmail}
              disabled={contactsLoading}
              loading={contactsLoading}
              onChange={(event) => onChange('recommenderEmail', event.target.value)}
              options={emailSelectOptions}
            />
          </label>
        </>
      )}
      {contactsQuery.isError ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <Button
            variant="secondary"
            loading={contactsQuery.isFetching}
            loadingLabel="Retrying…"
            onClick={() => void contactsQuery.refetch()}
          >
            Retry contact lookup
          </Button>
        </div>
      ) : null}
      {/* Acknowledged At - keep as date field */}
      {networkSelection ? (
        <>
          <div className={v4.sepline} style={{ gridColumn: '1 / -1' }} />
          <div className={v4.networkBottom} style={{ gridColumn: '1 / -1' }}>
            <label className={`${styles.filterLabel} ${v4.field}`}>
              <span>Acknowledged at</span>
              <input
                type="date"
                value={meta.acknowledgedAt}
                onChange={(event) => onChange('acknowledgedAt', event.target.value)}
                className="input-date"
              />
            </label>
            <p className={v4.helper}>
              Team eligibility is checked against the existing genealogy. Live validation is
              enforced by the Supabase backend before submission.
            </p>
          </div>
        </>
      ) : (
        <label className={`${styles.filterLabel} ${v4.field}`}>
          <span>Acknowledged At</span>
          <input
            type="date"
            value={meta.acknowledgedAt}
            onChange={(event) => onChange('acknowledgedAt', event.target.value)}
            className="input-date"
          />
        </label>
      )}
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

export const HOLDER_SECTIONS = ['personal', 'address', 'contact', 'work'] as const;
const holderSectionFields: Record<string, readonly string[]> = {
  personal: [
    'prefix',
    'firstName',
    'middleName',
    'lastName',
    'suffix',
    'birthDate',
    'sex',
    'citizenship',
    'civilStatus',
  ],
  address: [
    'permanentAddressLine1',
    'permanentAddressLine2',
    'province',
    'cityMunicipality',
    'barangay',
    'provinceCode',
    'cityMunicipalityCode',
    'barangayCode',
    'postalCode',
  ],
  contact: ['mobile', 'email', 'landline'],
  work: [
    'tinNumber',
    'occupationBusinessName',
    'officeBusinessAddress',
    'businessIndustry',
    'employedPosition',
    'printedName',
  ],
};
export function holderSectionBlocker(
  holder: ApplicationHolder,
  section: string,
  all = false,
): string | null {
  const result = applicationHolderSchema.safeParse(holder);
  if (result.success) return null;
  const issue = result.error.issues.find(
    (issue) => all || holderSectionFields[section]?.includes(String(issue.path[0])),
  );
  if (!issue) return null;
  const field = String(issue.path[0]);
  const group =
    Object.keys(holderSectionFields).find((key) => holderSectionFields[key]?.includes(field)) ??
    section;
  const label = group === 'work' ? 'Additional' : group[0]!.toUpperCase() + group.slice(1);
  return `Complete ${holder.holderType.toLowerCase()} holder ${label}: ${fieldLabel(field)}.`;
}
