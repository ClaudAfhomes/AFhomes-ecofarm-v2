import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Customer } from '@afhomes/contracts';
import {
  CIVIL_STATUS_OPTIONS,
  PAYMENT_SCHEMES,
  PAYMENT_SCHEME_LABELS,
  SUFFIX_OPTIONS,
  TEMPLATE_PAYMENT_METHOD_OPTIONS,
  TEMPLATE_TIER_OPTIONS,
  tinNumberSchema,
} from '@afhomes/contracts';
import { DateField as AppDateField, Field, SelectField, chainOptions } from './official-forms-fields';
import { Alert, Button, DateField, Dialog, Icon, Select, Tabs, TextField } from '@afhomes/ui';
import { formatStatedMoney } from '@afhomes/shared';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  filterBusinessTextInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterLandlineInput,
  filterMobileInput,
  formatTinInput,
} from '../../lib/normalize';
import { formatTin } from '../../lib/format';
import { GeographicAddressFields } from '../address/GeographicAddressFields';
import { businessKeys } from './queryKeys';
import { withStoredValue } from './official-forms-fields';
import { getGenealogy } from '../genealogy/services';
import { updateCustomer } from './services-customers';
import styles from './CustomerDetailPage.module.css';

type Props = {
  customer: Customer;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type EditSection = 'primary' | 'supplementary' | 'related' | 'package';

const EDIT_SECTIONS: { value: EditSection; label: string }[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'supplementary', label: 'Supplementary' },
  { value: 'related', label: 'Related' },
  { value: 'package', label: 'Package' },
];

/** Card header for one editable section: title, one-line blurb, tinted mark. */
function EditCardHead({
  title,
  blurb,
  icon,
  tone,
}: {
  title: string;
  blurb: string;
  icon: 'user' | 'user-plus' | 'users' | 'wallet';
  tone?: string;
}) {
  return (
    <header className={`${styles.editCardHead}${tone ? ` ${tone}` : ''}`}>
      <span className={styles.editCardMark} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className={styles.editCardHeading}>
        <h3 className={styles.editCardTitle}>{title}</h3>
        <p className={styles.editCardBlurb}>{blurb}</p>
      </div>
    </header>
  );
}

const text = (v: string | null | undefined) => v ?? '';
const addressPart = (address: unknown, key: string): string => {
  if (!address || typeof address !== 'object') return '';
  const part = (address as Record<string, unknown>)[key];
  return typeof part === 'string' ? part : '';
};

/** Keep money text clean (digits + one dot, ≤2 decimals) for storage. */
const filterMoneyInput = (value: string): string => {
  const stripped = value.replace(/[^0-9.]/g, '');
  const parts = stripped.split('.');
  const intPart = parts[0] ?? '';
  const decPart = parts.slice(1).join('').slice(0, 2);
  return parts.length > 1 ? `${intPart}.${decPart}` : intPart;
};

/** Money text that also displays grouped thousands while typing. */
const formatMoneyInput = (value: string): string => {
  const filtered = filterMoneyInput(value);
  if (filtered === '') return '';
  const formatted = formatStatedMoney(filtered);
  return formatted === '—' ? filtered : formatted;
};

// Customer gender is stored lowercase (contract enum) and displayed Title Case.
const CUSTOMER_GENDER_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'undisclosed', label: 'Undisclosed' },
];

// Sanctioned payment-status values for the company-stated STATUS field.
// Single source for this dialog; promote to packages/contracts only if a
// second consumer appears. Storage stays free text, so historical values
// outside this list still display verbatim.
const CUSTOMER_PAYMENT_STATUS_OPTIONS = [
  { value: '', label: 'Not Recorded' },
  { value: 'FULLY PAID', label: 'FULLY PAID' },
  { value: 'PARTIAL', label: 'PARTIAL' },
  { value: 'INSTALLMENT', label: 'INSTALLMENT' },
  { value: 'CANCELLED', label: 'CANCELLED' },
  { value: 'RF ONLY', label: 'RF ONLY' },
  { value: 'REFUNDED', label: 'REFUNDED' },
];

/**
 * Edit company-stated fields on the combined customer record.
 *
 * All 37 columns are verbatim: no value is translated, no hierarchy is
 * inferred, FULL NAME is never split. Stated package/payment figures never
 * drive server totals. TINs are prefilled from the single-record detail read
 * and locked behind a checkbox: unlocked they set (or clear), locked they keep.
 * The primary address parts and the two landlines are editable here; blank
 * parts fall back to the stored value, so a partial edit never wipes them.
 */
/**
 * True when the customer carries any company-stated supplementary member data.
 * Drives the initial state of the "Supplementary Member" checkbox.
 */
function hasSupplementaryRecord(customer: Customer): boolean {
  return [
    customer.supplementaryFullName,
    customer.supplementaryAddress,
    customer.supplementaryBirthday,
    customer.supplementaryGender,
    customer.supplementaryCitizenship,
    customer.supplementaryCivilStatus,
    customer.supplementaryTinNumberMasked,
    customer.supplementaryTinNumber,
    customer.supplementaryMobile,
    customer.supplementaryEmail,
    customer.supplementaryLandline,
    customer.supplementaryOccupationBusinessName,
    customer.supplementaryOfficeAddress,
    customer.supplementaryPosition,
  ].some((value) => typeof value === 'string' && value.trim() !== '');
}

export function CustomerCompanyEditDialog({ customer, open, onClose, onSaved }: Props) {
  const client = useQueryClient();
  const [form, setForm] = useState(() => ({
    firstName: text(customer.firstName),
    middleName: text(customer.middleName),
    lastName: text(customer.lastName),
    suffix: text(customer.suffix),
    dateOfBirth: text(customer.dateOfBirth),
    gender: text(customer.gender),
    email: text(customer.email),
    phone: text(customer.phone),
    raNumber: text(customer.raNumber),
    companyStatus: text(customer.companyStatus),
    addressLine1: addressPart(customer.address, 'line1'),
    addressLine2: addressPart(customer.address, 'line2'),
    province: addressPart(customer.address, 'province'),
    provinceCode: addressPart(customer.address, 'provinceCode') || undefined,
    city: addressPart(customer.address, 'city'),
    cityCode: addressPart(customer.address, 'cityCode') || undefined,
    barangay: addressPart(customer.address, 'barangay'),
    barangayCode: addressPart(customer.address, 'barangayCode') || undefined,
    postalCode: addressPart(customer.address, 'postalCode'),
    landline: text(customer.landline),
    citizenship: text(customer.citizenship),
    civilStatus: text(customer.civilStatus),
    tinNumber: formatTin(customer.tinNumber),
    occupationBusinessName: text(customer.occupationBusinessName),
    officeBusinessAddress: text(customer.officeBusinessAddress),
    employedPosition: text(customer.employedPosition),
    supplementaryFullName: text(customer.supplementaryFullName),
    supplementaryAddress: text(customer.supplementaryAddress),
    supplementaryBirthday: text(customer.supplementaryBirthday),
    supplementaryGender: text(customer.supplementaryGender),
    supplementaryCitizenship: text(customer.supplementaryCitizenship),
    supplementaryCivilStatus: text(customer.supplementaryCivilStatus),
    supplementaryTinNumber: formatTin(customer.supplementaryTinNumber),
    supplementaryMobile: text(customer.supplementaryMobile),
    supplementaryEmail: text(customer.supplementaryEmail),
    supplementaryLandline: text(customer.supplementaryLandline),
    supplementaryOccupationBusinessName: text(customer.supplementaryOccupationBusinessName),
    supplementaryOfficeAddress: text(customer.supplementaryOfficeAddress),
    supplementaryPosition: text(customer.supplementaryPosition),
    svdName: text(customer.svdName),
    ssmName: text(customer.ssmName),
    smName: text(customer.smName),
    referrerName: text(customer.referrerName),
    vipRecommenderName: text(customer.vipRecommenderName),
    relatedContactNo: text(customer.relatedContactNo),
    relatedEmail: text(customer.relatedEmail),
    statedVipPackage: text(customer.statedVipPackage),
    statedPaymentTerms: text(customer.statedPaymentTerms),
    statedRegularPrice: text(customer.statedRegularPrice),
    statedDiscount: text(customer.statedDiscount),
    statedTotalAmount: text(customer.statedTotalAmount),
    statedRf: text(customer.statedRf),
    statedPaymentType: text(customer.statedPaymentType),
    statedRefNo: text(customer.statedRefNo),
    statedPaymentDate: text(customer.statedPaymentDate),
  }));
  const [hasSupplementary, setHasSupplementary] = useState(() => hasSupplementaryRecord(customer));
  const [tinEditable, setTinEditable] = useState(false);
  const [supplementaryTinEditable, setSupplementaryTinEditable] = useState(false);
  const [section, setSection] = useState<EditSection>('primary');
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Active staff from the genealogy, used to populate the Related Persons
  // dropdowns (mirroring the Customer Applications form's RecommenderFields).
  // Stored values are names (the customer record's stated columns), so options
  // carry the staff member's full name and we keep a stored name visible even
  // when it is no longer an active staff member.
  const genealogy = useQuery({
    queryKey: ['genealogy', 'referral-chain'],
    queryFn: getGenealogy,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const genealogyNodes = genealogy.data ?? [];
  const staffIdForName = (name: string) => genealogyNodes.find((n) => n.fullName === name)?.staffId ?? null;
  const nearestAbove = (names: string[]) => {
    for (const n of names) if (n) { const id = staffIdForName(n); if (id) return id; }
    return null;
  };
  const relatedPersonOptions = (role: 'vice_director' | 'senior_sales_manager' | 'sales_manager' | 'ost', stored: string, aboveStaffId: string | null) => {
    const options = chainOptions(genealogyNodes, role, aboveStaffId).map((node) => ({
      value: node.fullName,
      label: node.fullName,
    }));
    return withStoredValue(options, stored || undefined);
  };

  const save = useBusinessMutation({
    mutationFn: () => {
      const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
      const address = customer.address && typeof customer.address === 'object'
        ? (customer.address as Record<string, unknown>)
        : {};
      const stored = (key: string) =>
        typeof address[key] === 'string' ? (address[key] as string) : '';
      return updateCustomer(customer.id, {
        firstName: orNull(form.firstName) ?? undefined,
        middleName: orNull(form.middleName),
        lastName: orNull(form.lastName) ?? undefined,
        suffix: orNull(form.suffix),
        gender: orNull(form.gender) as 'male' | 'female' | 'other' | 'undisclosed' | null,
        dateOfBirth: orNull(form.dateOfBirth),
        email: orNull(form.email) ?? undefined,
        phone: orNull(form.phone) ?? undefined,
        raNumber: orNull(form.raNumber),
        companyStatus: orNull(form.companyStatus),
        // Required parts fall back to the stored value; optional parts are
        // omitted when blank, never sent as empty strings.
        address: {
          line1: orNull(form.addressLine1) ?? stored('line1'),
          city: orNull(form.city) ?? stored('city'),
          province: orNull(form.province) ?? stored('province'),
          ...(form.addressLine2.trim() ? { line2: form.addressLine2.trim() } : {}),
          ...(form.barangay.trim() ? { barangay: form.barangay.trim() } : {}),
          ...(form.postalCode.trim() ? { postalCode: form.postalCode.trim() } : {}),
          countryCode: stored('countryCode') || 'PH',
        },
        landline: orNull(form.landline),
        citizenship: orNull(form.citizenship),
        civilStatus: orNull(form.civilStatus),
        // Locked keeps the stored value; unlocked sets it (blank clears).
        ...(tinEditable ? { tinNumber: orNull(form.tinNumber) } : {}),
        occupationBusinessName: orNull(form.occupationBusinessName),
        officeBusinessAddress: orNull(form.officeBusinessAddress),
        employedPosition: orNull(form.employedPosition),
        supplementaryFullName: hasSupplementary ? orNull(form.supplementaryFullName) : null,
        supplementaryAddress: hasSupplementary ? orNull(form.supplementaryAddress) : null,
        supplementaryBirthday: hasSupplementary ? orNull(form.supplementaryBirthday) : null,
        supplementaryGender: hasSupplementary
          ? (orNull(form.supplementaryGender) as 'male' | 'female' | 'other' | 'undisclosed' | null)
          : null,
        supplementaryCitizenship: hasSupplementary ? orNull(form.supplementaryCitizenship) : null,
        supplementaryCivilStatus: hasSupplementary ? orNull(form.supplementaryCivilStatus) : null,
        // Removing the second holder clears their TIN with the rest of the block.
        ...(hasSupplementary
          ? supplementaryTinEditable
            ? { supplementaryTinNumber: orNull(form.supplementaryTinNumber) }
            : {}
          : { supplementaryTinNumber: null }),
        supplementaryMobile: hasSupplementary ? orNull(form.supplementaryMobile) : null,
        supplementaryEmail: hasSupplementary ? orNull(form.supplementaryEmail) : null,
        supplementaryLandline: hasSupplementary ? orNull(form.supplementaryLandline) : null,
        supplementaryOccupationBusinessName: hasSupplementary
          ? orNull(form.supplementaryOccupationBusinessName)
          : null,
        supplementaryOfficeAddress: hasSupplementary ? orNull(form.supplementaryOfficeAddress) : null,
        supplementaryPosition: hasSupplementary ? orNull(form.supplementaryPosition) : null,
        svdName: orNull(form.svdName),
        ssmName: orNull(form.ssmName),
        smName: orNull(form.smName),
        referrerName: orNull(form.referrerName),
        vipRecommenderName: orNull(form.vipRecommenderName),
        relatedContactNo: orNull(form.relatedContactNo),
        relatedEmail: orNull(form.relatedEmail),
        statedVipPackage: orNull(form.statedVipPackage),
        statedPaymentTerms: orNull(form.statedPaymentTerms),
        statedRegularPrice: orNull(form.statedRegularPrice),
        statedDiscount: orNull(form.statedDiscount),
        statedTotalAmount: orNull(form.statedTotalAmount),
        statedRf: orNull(form.statedRf),
        statedPaymentType: orNull(form.statedPaymentType),
        statedRefNo: orNull(form.statedRefNo),
        statedPaymentDate: orNull(form.statedPaymentDate),
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: businessKeys.customerScope });
      onSaved();
      onClose();
    },
  });

  /** One mounted tab panel per section, hidden while inactive. */
  const panel = (value: EditSection) => ({
    id: `ce-sections-${value}-panel`,
    role: 'tabpanel' as const,
    'aria-labelledby': `ce-sections-${value}-tab`,
    hidden: section !== value,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit stated record"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} loadingLabel="Saving…">
            Save company record
          </Button>
        </>
      }
    >
      <div className={styles.editShell}>
        <div className={styles.editIntro}>
          <p>Stated record. Figures never affect totals.</p>
          <p>TINs are locked. Check to edit.</p>
        </div>
        {save.error ? <Alert variant="danger">{save.error.message}</Alert> : null}
        <Tabs
          items={EDIT_SECTIONS}
          value={section}
          onChange={(next) => setSection(next as EditSection)}
          baseId="ce-sections"
          ariaLabel="Edit stated record sections"
        />
        <section {...panel('primary')} className={styles.editCard}>
          <EditCardHead
            title="Primary Member"
            blurb="Identity and contact"
            icon="user"
            tone={styles.tonebrand}
          />
          <div className={styles.editCardBody}>
            <div className={styles.editFields}>
        <Field
          label="Last Name"
          value={form.lastName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('lastName')(v)}
          required
        />
        <Field
          label="First Name"
          value={form.firstName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('firstName')(v)}
          required
        />
        <Field
          label="Middle Name"
          value={form.middleName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('middleName')(v)}
        />
        <SelectField
          label="Suffix"
          value={form.suffix}
          onChange={(v) => set('suffix')(v)}
          options={withStoredValue(
            [{ value: '', label: 'None' }, ...SUFFIX_OPTIONS.map((v) => ({ value: v, label: v }))],
            form.suffix || undefined,
          )}
        />
        <AppDateField
          label="Birth Date"
          value={form.dateOfBirth}
          onChange={(v) => set('dateOfBirth')(v)}
          required
        />
        <SelectField
          label="Sex"
          value={form.gender}
          onChange={(v) => set('gender')(v)}
          options={withStoredValue(CUSTOMER_GENDER_OPTIONS, form.gender || undefined)}
        />
        <Field
          label="Email"
          value={form.email}
          normalize={(v) => v.toLowerCase()}
          onChange={(v) => set('email')(v)}
          type="email"
          required
        />
        <Field
          label="Mobile"
          value={form.phone}
          normalize={filterMobileInput}
          onChange={(v) => set('phone')(v)}
          required
        />
        <TextField
          id="ce-ra"
          name="raNumber"
          label="Ra No"
          value={form.raNumber}
          onChange={set('raNumber')}
        />
        <label className={styles.filterLabel}>
          Payment Status
          <Select
            id="ce-status"
            name="companyStatus"
            aria-label="Payment Status"
            value={form.companyStatus}
            onChange={(e) => set('companyStatus')(e.target.value)}
            options={withStoredValue(CUSTOMER_PAYMENT_STATUS_OPTIONS, form.companyStatus)}
          />
        </label>
        <TextField
          id="ce-addr1"
          name="addressLine1"
          label="Permanent Address Line 1"
          value={form.addressLine1}
          onChange={(value) => set('addressLine1')(filterHolderAddressInput(value))}
        />
        <TextField
          id="ce-addr2"
          name="addressLine2"
          label="Permanent Address Line 2"
          value={form.addressLine2}
          onChange={(value) => set('addressLine2')(filterHolderAddressInput(value))}
        />
        <div className={styles.editFieldWide}>
          <GeographicAddressFields
            idPrefix="ce"
            value={{
              province: form.province || undefined,
              provinceCode: form.provinceCode,
              cityMunicipality: form.city || undefined,
              cityMunicipalityCode: form.cityCode,
              barangay: form.barangay || undefined,
              barangayCode: form.barangayCode,
              postalCode: form.postalCode || undefined,
            }}
            onChange={(next) => {
              setForm((f) => ({
                ...f,
                province: next.province ?? f.province,
                provinceCode: next.provinceCode,
                city: next.cityMunicipality ?? f.city,
                cityCode: next.cityMunicipalityCode,
                barangay: next.barangay ?? f.barangay,
                barangayCode: next.barangayCode,
                postalCode: next.postalCode ?? f.postalCode,
              }));
            }}
          />
        </div>
        <TextField
          id="ce-postal"
          name="postalCode"
          label="Postal Code"
          value={form.postalCode}
          onChange={() => {}}
          readOnly
          optional
          hint="Filled from city."
        />
        <TextField
          id="ce-land"
          name="landline"
          label="Landline"
          value={form.landline}
          onChange={(value) => set('landline')(filterLandlineInput(value))}
        />
        <TextField
          id="ce-cit"
          name="citizenship"
          label="Citizenship"
          value={form.citizenship}
          onChange={(value) => set('citizenship')(filterHolderNameInput(value))}
        />
        <label className={styles.filterLabel}>
          Civil Status
          <Select
            id="ce-civil"
            name="civilStatus"
            aria-label="Civil Status"
            value={form.civilStatus}
            onChange={(e) => set('civilStatus')(e.target.value)}
            options={withStoredValue(
              CIVIL_STATUS_OPTIONS.map((v) => ({ value: v, label: v })),
              form.civilStatus || undefined,
            )}
          />
        </label>
        <div className={styles.tinField}>
          <Field
            label="Tin"
            value={form.tinNumber}
            normalize={formatTinInput}
            validate={tinEditable ? tinNumberSchema : null}
            validateMessage="Use 9-digit TIN e.g. 123-456-789."
            readOnly={!tinEditable}
            onChange={(v) => set('tinNumber')(v)}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={tinEditable}
              onChange={(e) => setTinEditable(e.target.checked)}
              aria-label="Edit TIN"
            />{' '}
            Edit TIN
          </label>
        </div>
        <TextField
          id="ce-occ"
          name="occupationBusinessName"
          label="Occupation / Business Name"
          value={form.occupationBusinessName}
          onChange={(value) => set('occupationBusinessName')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-office"
          name="officeBusinessAddress"
          label="Office / Business Address"
          value={form.officeBusinessAddress}
          onChange={(value) => set('officeBusinessAddress')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-pos"
          name="employedPosition"
          label="Employed Position"
          value={form.employedPosition}
          onChange={(value) => set('employedPosition')(filterBusinessTextInput(value))}
        />
            </div>
          </div>
        </section>
        <section {...panel('supplementary')} className={styles.editCard}>
          <EditCardHead
            title="Supplementary Member"
            blurb="Optional second member"
            icon="user-plus"
            tone={styles.toneinfo}
          />
          <div className={styles.editCardBody}>
            <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={hasSupplementary}
            onChange={(e) => setHasSupplementary(e.target.checked)}
            aria-label="Supplementary Member"
          />{' '}
          Supplementary Member
        </label>
            {hasSupplementary ? (
              <div className={styles.editFields}>
                <TextField
                  id="ce-sup-name"
          name="supplementaryFullName"
          label="Supplementary Full Name"
          value={form.supplementaryFullName}
          onChange={(value) => set('supplementaryFullName')(filterHolderNameInput(value))}
        />
        <TextField
          id="ce-sup-addr"
          name="supplementaryAddress"
          label="Address"
          value={form.supplementaryAddress}
          onChange={(value) => set('supplementaryAddress')(filterHolderAddressInput(value))}
        />
        <DateField
          id="ce-sup-bday"
          name="supplementaryBirthday"
          label="Birthday"
          optional
          value={form.supplementaryBirthday}
          onChange={set('supplementaryBirthday')}
        />
        <label className={styles.filterLabel}>
          Gender
          <Select
            aria-label="Gender"
            value={form.supplementaryGender}
            onChange={(e) => set('supplementaryGender')(e.target.value)}
            options={withStoredValue(CUSTOMER_GENDER_OPTIONS, form.supplementaryGender || undefined)}
          />
        </label>
        <TextField
          id="ce-sup-cit"
          name="supplementaryCitizenship"
          label="Citizenship"
          value={form.supplementaryCitizenship}
          onChange={(value) => set('supplementaryCitizenship')(filterHolderNameInput(value))}
        />
        <label className={styles.filterLabel}>
          Civil Status
          <Select
            id="ce-sup-civil"
            name="supplementaryCivilStatus"
            aria-label="Civil Status"
            value={form.supplementaryCivilStatus}
            onChange={(e) => set('supplementaryCivilStatus')(e.target.value)}
            options={withStoredValue(
              CIVIL_STATUS_OPTIONS.map((v) => ({ value: v, label: v })),
              form.supplementaryCivilStatus || undefined,
            )}
          />
        </label>
        <div className={styles.tinField}>
          <Field
            label="Tin"
            value={form.supplementaryTinNumber}
            normalize={formatTinInput}
            validate={supplementaryTinEditable ? tinNumberSchema : null}
            validateMessage="Use 9-digit TIN e.g. 123-456-789."
            readOnly={!supplementaryTinEditable}
            onChange={(v) => set('supplementaryTinNumber')(v)}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={supplementaryTinEditable}
              onChange={(e) => setSupplementaryTinEditable(e.target.checked)}
              aria-label="Edit Supplementary TIN"
            />{' '}
            Edit Supplementary TIN
          </label>
        </div>
        <TextField
          id="ce-sup-mob"
          name="supplementaryMobile"
          label="Mobile No."
          value={form.supplementaryMobile}
          onChange={(value) => set('supplementaryMobile')(filterMobileInput(value))}
        />
        <TextField
          id="ce-sup-email"
          name="supplementaryEmail"
          label="Email"
          value={form.supplementaryEmail}
          onChange={(value) => set('supplementaryEmail')(value.toLowerCase())}
        />
        <TextField
          id="ce-sup-land"
          name="supplementaryLandline"
          label="Landline"
          value={form.supplementaryLandline}
          onChange={(value) => set('supplementaryLandline')(filterLandlineInput(value))}
        />
        <TextField
          id="ce-sup-occ"
          name="supplementaryOccupationBusinessName"
          label="Occupation / Business Name"
          value={form.supplementaryOccupationBusinessName}
          onChange={(value) =>
            set('supplementaryOccupationBusinessName')(filterBusinessTextInput(value))
          }
        />
        <TextField
          id="ce-sup-office"
          name="supplementaryOfficeAddress"
          label="Office / Business Address"
          value={form.supplementaryOfficeAddress}
          onChange={(value) => set('supplementaryOfficeAddress')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-sup-pos"
          name="supplementaryPosition"
          label="Employed Position"
          value={form.supplementaryPosition}
          onChange={(value) => set('supplementaryPosition')(filterBusinessTextInput(value))}
        />
              </div>
            ) : (
              <p className={styles.editEmpty}>No supplementary member.</p>
            )}
          </div>
        </section>
        <section {...panel('related')} className={styles.editCard}>
          <EditCardHead
            title="Related Persons and Referral"
            blurb="Stated referral names"
            icon="users"
            tone={styles.toneneutral}
          />
          <div className={styles.editCardBody}>
            <div className={styles.editFields}>
        <label className={styles.filterLabel}>
          SVD (Name)
          <Select
            id="ce-svd"
            name="svdName"
            aria-label="SVD (Name)"
            value={form.svdName}
            onChange={(e) => set('svdName')(e.target.value)}
            options={relatedPersonOptions('vice_director', form.svdName, null)}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          SSM (Name)
          <Select
            id="ce-ssm"
            name="ssmName"
            aria-label="SSM (Name)"
            value={form.ssmName}
            onChange={(e) => set('ssmName')(e.target.value)}
            options={relatedPersonOptions('senior_sales_manager', form.ssmName, staffIdForName(form.svdName))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          SM (Name)
          <Select
            id="ce-sm"
            name="smName"
            aria-label="SM (Name)"
            value={form.smName}
            onChange={(e) => set('smName')(e.target.value)}
            options={relatedPersonOptions('sales_manager', form.smName, nearestAbove([form.ssmName, form.svdName]))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          Referrer (Name)
          <Select
            id="ce-ref"
            name="referrerName"
            aria-label="Referrer (Name)"
            value={form.referrerName}
            onChange={(e) => set('referrerName')(e.target.value)}
            options={relatedPersonOptions('ost', form.referrerName, nearestAbove([form.smName, form.ssmName, form.svdName]))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          VIP Recommender (Name)
          <Select
            id="ce-viprec"
            name="vipRecommenderName"
            aria-label="VIP Recommender (Name)"
            value={form.vipRecommenderName}
            onChange={(e) => set('vipRecommenderName')(e.target.value)}
            options={relatedPersonOptions('ost', form.vipRecommenderName, null)}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <TextField
          id="ce-rel-contact"
          name="relatedContactNo"
          label="Contact No."
          value={form.relatedContactNo}
          onChange={(value) => set('relatedContactNo')(filterMobileInput(value))}
        />
        <TextField
          id="ce-rel-email"
          name="relatedEmail"
          label="Email Address"
          value={form.relatedEmail}
          onChange={(value) => set('relatedEmail')(value.toLowerCase())}
        />
            </div>
          </div>
        </section>
        <section {...panel('package')} className={styles.editCard}>
          <EditCardHead
            title="Package and Payment (company stated)"
            blurb="Company figures only"
            icon="wallet"
            tone={styles.tonegold}
          />
          <div className={styles.editCardBody}>
            <div className={styles.editFields}>
        <label className={styles.filterLabel}>
          VIP Package
          <Select
            id="ce-pkg"
            name="statedVipPackage"
            aria-label="VIP Package"
            value={form.statedVipPackage}
            onChange={(e) => set('statedVipPackage')(e.target.value)}
            options={withStoredValue(
              [{ value: '', label: 'Not Recorded' }, ...TEMPLATE_TIER_OPTIONS.map((v) => ({ value: v, label: v }))],
              form.statedVipPackage || undefined,
            )}
          />
        </label>
        <label className={styles.filterLabel}>
          Payment Terms
          <Select
            id="ce-terms"
            name="statedPaymentTerms"
            aria-label="Payment Terms"
            value={form.statedPaymentTerms}
            onChange={(e) => set('statedPaymentTerms')(e.target.value)}
            options={withStoredValue(
              [{ value: '', label: 'Not Recorded' }, ...PAYMENT_SCHEMES.map((v) => ({ value: v, label: PAYMENT_SCHEME_LABELS[v] }))],
              form.statedPaymentTerms || undefined,
            )}
          />
        </label>
        <TextField
          id="ce-reg"
          name="statedRegularPrice"
          label="Regular Price"
          value={form.statedRegularPrice}
          onChange={(value) => set('statedRegularPrice')(formatMoneyInput(value))}
          inputMode="decimal"
        />
        <TextField
          id="ce-disc"
          name="statedDiscount"
          label="Discount"
          value={form.statedDiscount}
          onChange={(value) => set('statedDiscount')(formatMoneyInput(value))}
          inputMode="decimal"
        />
        <TextField
          id="ce-total"
          name="statedTotalAmount"
          label="Total Amount"
          value={form.statedTotalAmount}
          onChange={(value) => set('statedTotalAmount')(formatMoneyInput(value))}
          inputMode="decimal"
        />
        <TextField
          id="ce-rf"
          name="statedRf"
          label="Reservation Fee"
          value={form.statedRf}
          onChange={(value) => set('statedRf')(filterMoneyInput(value))}
          inputMode="decimal"
          hint={form.statedRf ? formatStatedMoney(form.statedRf) : undefined}
        />
        <label className={styles.filterLabel}>
          Payment Type
          <Select
            id="ce-ptype"
            name="statedPaymentType"
            aria-label="Payment Type"
            value={form.statedPaymentType}
            onChange={(e) => set('statedPaymentType')(e.target.value)}
            options={withStoredValue(
              TEMPLATE_PAYMENT_METHOD_OPTIONS.map((v) => ({
                value: v,
                label:
                  v === 'cash'
                    ? 'Cash'
                    : v === 'bank_transfer'
                      ? 'Bank transfer'
                      : v === 'gcash'
                        ? 'Gcash'
                        : v === 'maya'
                          ? 'Maya'
                          : v === 'card'
                            ? 'Card'
                            : 'Cheque',
              })),
              form.statedPaymentType || undefined,
            )}
          />
        </label>
        <TextField
          id="ce-refno"
          name="statedRefNo"
          label="Ref No"
          value={form.statedRefNo}
          onChange={set('statedRefNo')}
        />
        <DateField
          id="ce-pdate"
          name="statedPaymentDate"
          label="Payment Date"
          optional
          value={form.statedPaymentDate}
          onChange={set('statedPaymentDate')}
        />
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
