import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Customer } from '@afhomes/contracts';
import {
  CIVIL_STATUS_OPTIONS,
  PAYMENT_SCHEMES,
  PAYMENT_SCHEME_LABELS,
  SEX_OPTIONS,
  SUFFIX_OPTIONS,
  TEMPLATE_PAYMENT_METHOD_OPTIONS,
  TEMPLATE_TIER_OPTIONS,
  tinNumberSchema,
} from '@afhomes/contracts';
import { DateField as AppDateField, Field, SelectField, chainOptions } from './official-forms-fields';
import { Alert, Button, DateField, Dialog, Select, TextField } from '@afhomes/ui';
import { formatStatedMoney } from '@afhomes/shared';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  filterBusinessTextInput,
  filterHolderAddressInput,
  filterHolderNameInput,
  filterLandlineInput,
  filterMobileInput,
  filterTinInput,
} from '../../lib/normalize';
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
 * drive server totals. TIN inputs are write-only: they start empty (the API
 * only returns a mask), a filled value sets, an empty value keeps.
 * The primary address parts and the two landlines are editable here; blank
 * parts fall back to the stored value, so a partial edit never wipes them.
 */
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
    tinNumber: '',
    occupationBusinessName: text(customer.occupationBusinessName),
    officeBusinessAddress: text(customer.officeBusinessAddress),
    employedPosition: text(customer.employedPosition),
    supplementaryFullName: text(customer.supplementaryFullName),
    supplementaryAddress: text(customer.supplementaryAddress),
    supplementaryBirthday: text(customer.supplementaryBirthday),
    supplementaryGender: text(customer.supplementaryGender),
    supplementaryCitizenship: text(customer.supplementaryCitizenship),
    supplementaryCivilStatus: text(customer.supplementaryCivilStatus),
    supplementaryTinNumber: '',
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
        // Write-only: empty keeps the stored value, filled sets it.
        ...(form.tinNumber.trim() ? { tinNumber: form.tinNumber.trim() } : {}),
        occupationBusinessName: orNull(form.occupationBusinessName),
        officeBusinessAddress: orNull(form.officeBusinessAddress),
        employedPosition: orNull(form.employedPosition),
        supplementaryFullName: orNull(form.supplementaryFullName),
        supplementaryAddress: orNull(form.supplementaryAddress),
        supplementaryBirthday: orNull(form.supplementaryBirthday),
        supplementaryGender: orNull(form.supplementaryGender) as
          'male' | 'female' | 'other' | 'undisclosed' | null,
        supplementaryCitizenship: orNull(form.supplementaryCitizenship),
        supplementaryCivilStatus: orNull(form.supplementaryCivilStatus),
        ...(form.supplementaryTinNumber.trim()
          ? { supplementaryTinNumber: form.supplementaryTinNumber.trim() }
          : {}),
        supplementaryMobile: orNull(form.supplementaryMobile),
        supplementaryEmail: orNull(form.supplementaryEmail),
        supplementaryLandline: orNull(form.supplementaryLandline),
        supplementaryOccupationBusinessName: orNull(form.supplementaryOccupationBusinessName),
        supplementaryOfficeAddress: orNull(form.supplementaryOfficeAddress),
        supplementaryPosition: orNull(form.supplementaryPosition),
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
      <div className={styles.editGrid}>
        <p>
          Verbatim stated record. Stated figures never affect verified totals. TIN is write-only
          (current: {customer.tinNumberMasked ?? 'Not Recorded'}); leave blank to keep.
        </p>
        {save.error ? <Alert variant="danger">{save.error.message}</Alert> : null}
        <h3>Primary Member</h3>
        <Field
          label="Last name"
          value={form.lastName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('lastName')(v)}
          required
        />
        <Field
          label="First name"
          value={form.firstName}
          suggestName
          normalize={filterHolderNameInput}
          onChange={(v) => set('firstName')(v)}
          required
        />
        <Field
          label="Middle name"
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
          label="Birth date"
          value={form.dateOfBirth}
          onChange={(v) => set('dateOfBirth')(v)}
          required
        />
        <SelectField
          label="Sex"
          value={form.gender}
          onChange={(v) => set('gender')(v)}
          options={withStoredValue(
            [{ value: '', label: 'Not specified' }, ...SEX_OPTIONS.map((v) => ({ value: v, label: v }))],
            form.gender || undefined,
          )}
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
          label="RA NO"
          value={form.raNumber}
          onChange={set('raNumber')}
        />
        <label className={styles.filterLabel}>
          PAYMENT STATUS
          <Select
            id="ce-status"
            name="companyStatus"
            aria-label="PAYMENT STATUS"
            value={form.companyStatus}
            onChange={(e) => set('companyStatus')(e.target.value)}
            options={withStoredValue(CUSTOMER_PAYMENT_STATUS_OPTIONS, form.companyStatus)}
          />
        </label>
        <TextField
          id="ce-addr1"
          name="addressLine1"
          label="PERMANENT ADDRESS LINE 1"
          value={form.addressLine1}
          onChange={(value) => set('addressLine1')(filterHolderAddressInput(value))}
        />
        <TextField
          id="ce-addr2"
          name="addressLine2"
          label="PERMANENT ADDRESS LINE 2"
          value={form.addressLine2}
          onChange={(value) => set('addressLine2')(filterHolderAddressInput(value))}
        />
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
        <TextField
          id="ce-postal"
          name="postalCode"
          label="POSTAL CODE"
          value={form.postalCode}
          onChange={() => {}}
          readOnly
          optional
          hint="Filled from the city / municipality."
        />
        <TextField
          id="ce-land"
          name="landline"
          label="LANDLINE"
          value={form.landline}
          onChange={(value) => set('landline')(filterLandlineInput(value))}
        />
        <TextField
          id="ce-cit"
          name="citizenship"
          label="CITIZENSHIP"
          value={form.citizenship}
          onChange={(value) => set('citizenship')(filterHolderNameInput(value))}
        />
        <label className={styles.filterLabel}>
          CIVIL STATUS
          <Select
            id="ce-civil"
            name="civilStatus"
            aria-label="CIVIL STATUS"
            value={form.civilStatus}
            onChange={(e) => set('civilStatus')(e.target.value)}
            options={withStoredValue(
              CIVIL_STATUS_OPTIONS.map((v) => ({ value: v, label: v })),
              form.civilStatus || undefined,
            )}
          />
        </label>
        <Field
          label="TIN"
          value={form.tinNumber}
          normalize={filterTinInput}
          validate={tinNumberSchema}
          validateMessage="Use a 9-digit TIN, for example 123-456-789."
          onChange={(v) => set('tinNumber')(v)}
        />
        <TextField
          id="ce-occ"
          name="occupationBusinessName"
          label="OCCUPATION / BUSINESS NAME"
          value={form.occupationBusinessName}
          onChange={(value) => set('occupationBusinessName')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-office"
          name="officeBusinessAddress"
          label="OFFICE / BUSINESS ADDRESS"
          value={form.officeBusinessAddress}
          onChange={(value) => set('officeBusinessAddress')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-pos"
          name="employedPosition"
          label="EMPLOYED POSITION"
          value={form.employedPosition}
          onChange={(value) => set('employedPosition')(filterBusinessTextInput(value))}
        />
        <h3>Supplementary Member</h3>
        <TextField
          id="ce-sup-name"
          name="supplementaryFullName"
          label="SUPPLEMENTARY FULL NAME"
          value={form.supplementaryFullName}
          onChange={(value) => set('supplementaryFullName')(filterHolderNameInput(value))}
        />
        <TextField
          id="ce-sup-addr"
          name="supplementaryAddress"
          label="ADDRESS"
          value={form.supplementaryAddress}
          onChange={(value) => set('supplementaryAddress')(filterHolderAddressInput(value))}
        />
        <DateField
          id="ce-sup-bday"
          name="supplementaryBirthday"
          label="BIRTHDAY"
          optional
          value={form.supplementaryBirthday}
          onChange={set('supplementaryBirthday')}
        />
        <label className={styles.filterLabel}>
          GENDER
          <Select
            aria-label="GENDER"
            value={form.supplementaryGender}
            onChange={(e) => set('supplementaryGender')(e.target.value)}
            options={withStoredValue(
              [
                { value: '', label: 'Not specified' },
                { value: 'male', label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'other', label: 'Other' },
                { value: 'undisclosed', label: 'Undisclosed' },
              ],
              form.supplementaryGender || undefined,
            )}
          />
        </label>
        <TextField
          id="ce-sup-cit"
          name="supplementaryCitizenship"
          label="CITIZENSHIP"
          value={form.supplementaryCitizenship}
          onChange={(value) => set('supplementaryCitizenship')(filterHolderNameInput(value))}
        />
        <label className={styles.filterLabel}>
          CIVIL STATUS
          <Select
            id="ce-sup-civil"
            name="supplementaryCivilStatus"
            aria-label="CIVIL STATUS"
            value={form.supplementaryCivilStatus}
            onChange={(e) => set('supplementaryCivilStatus')(e.target.value)}
            options={withStoredValue(
              CIVIL_STATUS_OPTIONS.map((v) => ({ value: v, label: v })),
              form.supplementaryCivilStatus || undefined,
            )}
          />
        </label>
        <Field
          label="TIN"
          value={form.supplementaryTinNumber}
          normalize={filterTinInput}
          validate={tinNumberSchema}
          validateMessage="Use a 9-digit TIN, for example 123-456-789."
          onChange={(v) => set('supplementaryTinNumber')(v)}
        />
        <TextField
          id="ce-sup-mob"
          name="supplementaryMobile"
          label="MOBILE NO."
          value={form.supplementaryMobile}
          onChange={(value) => set('supplementaryMobile')(filterMobileInput(value))}
        />
        <TextField
          id="ce-sup-email"
          name="supplementaryEmail"
          label="EMAIL"
          value={form.supplementaryEmail}
          onChange={(value) => set('supplementaryEmail')(value.toLowerCase())}
        />
        <TextField
          id="ce-sup-land"
          name="supplementaryLandline"
          label="LANDLINE"
          value={form.supplementaryLandline}
          onChange={(value) => set('supplementaryLandline')(filterLandlineInput(value))}
        />
        <TextField
          id="ce-sup-occ"
          name="supplementaryOccupationBusinessName"
          label="OCCUPATION / BUSINESS NAME"
          value={form.supplementaryOccupationBusinessName}
          onChange={(value) =>
            set('supplementaryOccupationBusinessName')(filterBusinessTextInput(value))
          }
        />
        <TextField
          id="ce-sup-office"
          name="supplementaryOfficeAddress"
          label="OFFICE / BUSINESS ADDRESS"
          value={form.supplementaryOfficeAddress}
          onChange={(value) => set('supplementaryOfficeAddress')(filterBusinessTextInput(value))}
        />
        <TextField
          id="ce-sup-pos"
          name="supplementaryPosition"
          label="EMPLOYED POSITION"
          value={form.supplementaryPosition}
          onChange={(value) => set('supplementaryPosition')(filterBusinessTextInput(value))}
        />
        <h3>Related Persons and Referral</h3>

        <label className={styles.filterLabel}>
          SVD (NAME)
          <Select
            id="ce-svd"
            name="svdName"
            aria-label="SVD (NAME)"
            value={form.svdName}
            onChange={(e) => set('svdName')(e.target.value)}
            options={relatedPersonOptions('vice_director', form.svdName, null)}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          SSM (NAME)
          <Select
            id="ce-ssm"
            name="ssmName"
            aria-label="SSM (NAME)"
            value={form.ssmName}
            onChange={(e) => set('ssmName')(e.target.value)}
            options={relatedPersonOptions('senior_sales_manager', form.ssmName, staffIdForName(form.svdName))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          SM (NAME)
          <Select
            id="ce-sm"
            name="smName"
            aria-label="SM (NAME)"
            value={form.smName}
            onChange={(e) => set('smName')(e.target.value)}
            options={relatedPersonOptions('sales_manager', form.smName, nearestAbove([form.ssmName, form.svdName]))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          REFERRER (NAME)
          <Select
            id="ce-ref"
            name="referrerName"
            aria-label="REFERRER (NAME)"
            value={form.referrerName}
            onChange={(e) => set('referrerName')(e.target.value)}
            options={relatedPersonOptions('ost', form.referrerName, nearestAbove([form.smName, form.ssmName, form.svdName]))}
            disabled={genealogy.isPending}
            loading={genealogy.isPending}
          />
        </label>
        <label className={styles.filterLabel}>
          VIP RECOMMENDER (NAME)
          <Select
            id="ce-viprec"
            name="vipRecommenderName"
            aria-label="VIP RECOMMENDER (NAME)"
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
          label="CONTACT NO."
          value={form.relatedContactNo}
          onChange={(value) => set('relatedContactNo')(filterMobileInput(value))}
        />
        <TextField
          id="ce-rel-email"
          name="relatedEmail"
          label="EMAIL ADDRESS"
          value={form.relatedEmail}
          onChange={(value) => set('relatedEmail')(value.toLowerCase())}
        />
        <h3>Package and Payment (company stated)</h3>
        <label className={styles.filterLabel}>
          VIP PACKAGE
          <Select
            id="ce-pkg"
            name="statedVipPackage"
            aria-label="VIP PACKAGE"
            value={form.statedVipPackage}
            onChange={(e) => set('statedVipPackage')(e.target.value)}
            options={withStoredValue(
              TEMPLATE_TIER_OPTIONS.map((v) => ({ value: v, label: v })),
              form.statedVipPackage || undefined,
            )}
          />
        </label>
        <label className={styles.filterLabel}>
          PAYMENT TERMS
          <Select
            id="ce-terms"
            name="statedPaymentTerms"
            aria-label="PAYMENT TERMS"
            value={form.statedPaymentTerms}
            onChange={(e) => set('statedPaymentTerms')(e.target.value)}
            options={withStoredValue(
              PAYMENT_SCHEMES.map((v) => ({ value: v, label: PAYMENT_SCHEME_LABELS[v] })),
              form.statedPaymentTerms || undefined,
            )}
          />
        </label>
        <TextField
          id="ce-reg"
          name="statedRegularPrice"
          label="REGULAR PRICE"
          value={form.statedRegularPrice}
          onChange={(value) => set('statedRegularPrice')(filterMoneyInput(value))}
          inputMode="decimal"
          hint={form.statedRegularPrice ? formatStatedMoney(form.statedRegularPrice) : undefined}
        />
        <TextField
          id="ce-disc"
          name="statedDiscount"
          label="DISCOUNT"
          value={form.statedDiscount}
          onChange={(value) => set('statedDiscount')(filterMoneyInput(value))}
          inputMode="decimal"
          hint={form.statedDiscount ? formatStatedMoney(form.statedDiscount) : undefined}
        />
        <TextField
          id="ce-total"
          name="statedTotalAmount"
          label="TOTAL AMOUNT"
          value={form.statedTotalAmount}
          onChange={(value) => set('statedTotalAmount')(filterMoneyInput(value))}
          inputMode="decimal"
          hint={form.statedTotalAmount ? formatStatedMoney(form.statedTotalAmount) : undefined}
        />
        <TextField
          id="ce-rf"
          name="statedRf"
          label="RF"
          value={form.statedRf}
          onChange={(value) => set('statedRf')(filterMoneyInput(value))}
          inputMode="decimal"
          hint={form.statedRf ? formatStatedMoney(form.statedRf) : undefined}
        />
        <label className={styles.filterLabel}>
          PAYMENT TYPE
          <Select
            id="ce-ptype"
            name="statedPaymentType"
            aria-label="PAYMENT TYPE"
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
          label="REF NO"
          value={form.statedRefNo}
          onChange={set('statedRefNo')}
        />
        <DateField
          id="ce-pdate"
          name="statedPaymentDate"
          label="PAYMENT DATE"
          optional
          value={form.statedPaymentDate}
          onChange={set('statedPaymentDate')}
        />
      </div>
    </Dialog>
  );
}
