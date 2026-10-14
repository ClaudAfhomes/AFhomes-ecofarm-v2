/**
 * Official-form field kit.
 *
 * Shared inputs, labels, tier vocabulary, and paging constants for the customer-application and reservation-agreement editors.
 */
import { HumanInput as NormalizedInput } from '../../lib/HumanInput';
import { useId, useState } from 'react';
import type { ApplicationHolder, Customer } from '@afhomes/contracts';
import { useQuery } from '@tanstack/react-query';
import { Combobox, type ComboboxOption } from '@afhomes/ui';
import { getGenealogy } from '../genealogy/services';
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
  readOnly = false,
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
  readOnly?: boolean;
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
        readOnly={readOnly}
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
export interface HierarchySelection {
  vdStaffId?: string;
  ssmStaffId?: string;
  smStaffId?: string;
  referrerOstId?: string;
}

export function HierarchyFields({
  value,
  fallbackSmName,
  fallbackReferrerName,
  onChange,
  disabled = false,
}: {
  value: HierarchySelection;
  /** Stored SM snapshot for records written before the selectors existed. */
  fallbackSmName: string;
  /** Stored referrer snapshot for records written before the selectors existed. */
  fallbackReferrerName: string;
  onChange: (next: HierarchySelection & { salesManagerName: string; vipReferrer: string }) => void;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const genealogy = useQuery({
    queryKey: ['genealogy'],
    queryFn: getGenealogy,
    // Like the address lists: fetch on first reach, not on page load.
    enabled: opened || Boolean(value.vdStaffId ?? value.ssmStaffId ?? value.smStaffId),
  });
  const nodes = genealogy.data ?? [];
  const active = (role: string, upline: string | null) =>
    nodes
      .filter(
        (n) => n.role === role && n.status === 'active' && (n.uplineStaffId ?? null) === upline,
      )
      .map((n): ComboboxOption => ({ code: n.staffId, name: n.fullName }));
  const vdOptions = nodes
    .filter((n) => n.role === 'vice_director' && n.status === 'active' && !n.uplineStaffId)
    .map((n): ComboboxOption => ({ code: n.staffId, name: n.fullName }));
  const ssmOptions = value.vdStaffId ? active('senior_sales_manager', value.vdStaffId) : [];
  const smOptions = value.ssmStaffId ? active('sales_manager', value.ssmStaffId) : [];
  /**
   * Referring OSTs: accredited only. `ostStatus` comes from the OST membership
   * record itself, so only `active` is eligible - a pending or suspended OST
   * cannot refer, and a seller without a membership row cannot satisfy the
   * reference the server persists.
   */
  const ostOptions = value.smStaffId
    ? nodes
        .filter(
          (n) =>
            n.role === 'ost' &&
            n.status === 'active' &&
            n.ostStatus === 'active' &&
            (n.uplineStaffId ?? null) === value.smStaffId,
        )
        .map((n): ComboboxOption => ({ code: n.staffId, name: n.fullName }))
    : [];
  const shownAs = (id: string | undefined, options: ComboboxOption[], legacyName: string) => {
    const found = options.find((o) => o.code === id);
    if (found) return found;
    // A stored id the list does not recognise (inactive, moved, deleted) keeps
    // its snapshot visible but unverified: empty code, never an invented id.
    if (id) return { code: '', name: `${legacyName || 'Previously selected'} — reselect` };
    if (legacyName && options.length === 0) return null;
    return null;
  };
  const vdValue = shownAs(value.vdStaffId, vdOptions, '');
  const ssmValue = shownAs(value.ssmStaffId, ssmOptions, '');
  const smValue =
    shownAs(value.smStaffId, smOptions, '') ??
    (!value.smStaffId && fallbackSmName ? { code: '', name: fallbackSmName } : null);
  const ostValue =
    shownAs(value.referrerOstId, ostOptions, '') ??
    (!value.referrerOstId && fallbackReferrerName
      ? { code: '', name: fallbackReferrerName }
      : null);
  // The SM display name, resolved live: the stored snapshot is only a fallback
  // for records whose member left the eligible list.
  const smName = smOptions.find((o) => o.code === value.smStaffId)?.name ?? fallbackSmName;
  const stale =
    // Only once the list has loaded: while it is still fetching, every stored
    // id is "unrecognised" and would flash a reselect warning for no reason.
    genealogy.data !== undefined &&
    ((value.vdStaffId && vdValue?.code === '') ||
      (value.ssmStaffId && ssmValue?.code === '') ||
      (value.smStaffId && smValue?.code === '') ||
      (value.referrerOstId && ostValue?.code === ''));
  const loadError = genealogy.isError ? 'Unable to load the sales hierarchy. Try again.' : null;
  return (
    <>
      <Combobox
        id="recommender-vd"
        label="Vice Director"
        disabled={disabled}
        onOpen={() => setOpened(true)}
        loadingLabel="Loading Vice Directors"
        loading={genealogy.isFetching}
        error={loadError}
        onRetry={() => void genealogy.refetch()}
        value={vdValue}
        options={vdOptions}
        placeholder="Search or select Vice Director"
        emptyMessage="No eligible Vice Directors"
        onSelect={(option) =>
          onChange({
            vdStaffId: option?.code || undefined,
            ssmStaffId: undefined,
            smStaffId: undefined,
            referrerOstId: undefined,
            salesManagerName: '',
            vipReferrer: '',
          })
        }
      />
      <Combobox
        id="recommender-ssm"
        label="Senior Sales Manager"
        disabled={disabled || !value.vdStaffId}
        disabledHint="Select a Vice Director first"
        loading={genealogy.isFetching}
        loadingLabel="Loading Senior Sales Managers"
        error={loadError}
        onRetry={() => void genealogy.refetch()}
        value={ssmValue}
        options={ssmOptions}
        placeholder="Search or select SSM"
        emptyMessage={
          value.vdStaffId ? 'This Vice Director has no Senior Sales Manager' : undefined
        }
        onSelect={(option) =>
          onChange({
            vdStaffId: value.vdStaffId,
            ssmStaffId: option?.code || undefined,
            smStaffId: undefined,
            referrerOstId: undefined,
            salesManagerName: '',
            vipReferrer: '',
          })
        }
      />
      <Combobox
        id="recommender-sm"
        label="Sales Manager"
        disabled={disabled || !value.ssmStaffId}
        disabledHint="Select a Senior Sales Manager first"
        loading={genealogy.isFetching}
        loadingLabel="Loading Sales Managers"
        error={loadError}
        onRetry={() => void genealogy.refetch()}
        value={smValue}
        options={smOptions}
        placeholder="Search or select SM"
        emptyMessage={
          value.ssmStaffId ? 'This Senior Sales Manager has no Sales Manager' : undefined
        }
        onSelect={(option) =>
          onChange({
            vdStaffId: value.vdStaffId,
            ssmStaffId: value.ssmStaffId,
            smStaffId: option?.code || undefined,
            referrerOstId: undefined,
            salesManagerName: option?.name ?? '',
            vipReferrer: '',
          })
        }
      />
      <Combobox
        id="recommender-ost"
        label="Referring OST"
        disabled={disabled || !value.smStaffId}
        disabledHint="Select a Sales Manager first"
        loading={genealogy.isFetching}
        loadingLabel="Loading OST referrers"
        error={loadError}
        onRetry={() => void genealogy.refetch()}
        value={ostValue}
        options={ostOptions}
        placeholder="Search or select OST referrer"
        emptyMessage={value.smStaffId ? 'This Sales Manager has no OST' : undefined}
        onSelect={(option) =>
          onChange({
            vdStaffId: value.vdStaffId,
            ssmStaffId: value.ssmStaffId,
            smStaffId: value.smStaffId,
            referrerOstId: option?.code || undefined,
            salesManagerName: smName,
            vipReferrer: option?.name ?? '',
          })
        }
      />
      {stale && !disabled ? (
        <p role="status">
          A previously selected member is no longer eligible. Choose again from the list.
        </p>
      ) : null}
    </>
  );
}

/**
 * VIP recommender lookup from the existing customer directory.
 *
 * Selecting a record copies its authoritative phone and email into the
 * snapshots; clearing the selection clears what was copied. The snapshots stay
 * editable only while no record is linked (legacy free-text entries); a linked
 * record's contact details are read-only here and corrected on the customer
 * record, never by overwriting this form. Nothing is invented when the record
 * has no contact on file.
 */
export interface RecommenderSelection {
  recommenderCustomerId?: string;
  vipRecommenderName: string;
  recommenderContact: string;
  recommenderEmail: string;
}

export function VipRecommenderFields({
  value,
  customers,
  customersLoading,
  customersError,
  onRetryCustomers,
  onChange,
  disabled = false,
  onSearch,}: {
  value: RecommenderSelection;
  customers: Customer[];
  customersLoading: boolean;
  customersError: string | null;
  onRetryCustomers: () => void;
  onChange: (next: RecommenderSelection) => void;
  disabled?: boolean;
  onSearch?: (query: string) => void;}) {
  const options: ComboboxOption[] = customers.map((c) => ({
    code: c.id,
    name: c.fullName,
    // The number is part of the answer: duplicate names stay distinguishable
    // to assistive tech through the option's accessible name.
    type: c.customerNumber,
  }));
  const selected = customers.find((c) => c.id === value.recommenderCustomerId) ?? null;
  const comboboxValue: ComboboxOption | null = selected
    ? { code: selected.id, name: selected.fullName }
    : value.vipRecommenderName
      ? { code: '', name: value.vipRecommenderName }
      : null;
  const linked = Boolean(selected);
  return (
    <>
      <Combobox
        id="vip-recommender"
        label="VIP Recommender Name"
        onSearch={onSearch}        onOpen={() => onSearch?.('')}        disabled={disabled}
        loading={customersLoading}
        loadingLabel="Loading recommenders"
        error={customersError}
        onRetry={onRetryCustomers}
        value={comboboxValue}
        options={options}
        placeholder="Search recommender by name"
        emptyMessage="No matching recommender"
        onSelect={(option) => {
          if (!option || !option.code) {
            onChange({
              recommenderCustomerId: undefined,
              vipRecommenderName: '',
              recommenderContact: '',
              recommenderEmail: '',
            });
            return;
          }
          const customer = customers.find((c) => c.id === option.code);
          if (!customer) return;
          onChange({
            recommenderCustomerId: customer.id,
            vipRecommenderName: customer.fullName,
            recommenderContact: customer.phone ?? '',
            recommenderEmail: customer.email ?? '',
          });
        }}
      />
      {comboboxValue && !linked && !disabled ? (
        <p role="status">
          Historical entry, not linked to a record. Search and select the recommender to link it.
        </p>
      ) : null}
      <Field
        label="Recommender Contact"
        value={value.recommenderContact}
        optionalPhone
        normalize={(v) => normalizeLiveHumanField('recommenderContact', v)}
        onChange={(v) =>
          onChange({ ...value, recommenderContact: v, recommenderCustomerId: undefined })
        }
        readOnly={linked}
        placeholder={linked && !value.recommenderContact ? 'No contact on record' : undefined}
      />
      <Field
        label="Recommender Email"
        value={value.recommenderEmail}
        normalize={(v) => normalizeLiveHumanField('recommenderEmail', v)}
        onChange={(v) =>
          onChange({ ...value, recommenderEmail: v, recommenderCustomerId: undefined })
        }
        readOnly={linked}
        placeholder={linked && !value.recommenderEmail ? 'No email on record' : undefined}
      />
    </>
  );
}
