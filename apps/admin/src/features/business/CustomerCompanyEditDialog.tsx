import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Customer } from '@afhomes/contracts';
import { Alert, Button, DateField, Dialog, Select, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { businessKeys } from './queryKeys';
import { updateCustomer } from './services-customers';
import styles from './CustomerDetailPage.module.css';

type Props = {
  customer: Customer;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const text = (v: string | null | undefined) => v ?? '';

/**
 * Edit company-stated fields on the combined customer record.
 *
 * All 37 columns are verbatim: no value is translated, no hierarchy is
 * inferred, FULL NAME is never split. Stated package/payment figures never
 * drive server totals. TIN inputs are write-only: they start empty (the API
 * only returns a mask), a filled value sets, an empty value keeps.
 */
export function CustomerCompanyEditDialog({ customer, open, onClose, onSaved }: Props) {
  const client = useQueryClient();
  const [form, setForm] = useState(() => ({
    raNumber: text(customer.raNumber),
    companyStatus: text(customer.companyStatus),
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
    supplementaryOccupationBusinessName: text(customer.supplementaryOccupationBusinessName),
    supplementaryOfficeAddress: text(customer.supplementaryOfficeAddress),
    supplementaryPosition: text(customer.supplementaryPosition),
    ostIstName: text(customer.ostIstName),
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

  const save = useBusinessMutation({
    mutationFn: () => {
      const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
      return updateCustomer(customer.id, {
        raNumber: orNull(form.raNumber),
        companyStatus: orNull(form.companyStatus),
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
        supplementaryOccupationBusinessName: orNull(form.supplementaryOccupationBusinessName),
        supplementaryOfficeAddress: orNull(form.supplementaryOfficeAddress),
        supplementaryPosition: orNull(form.supplementaryPosition),
        ostIstName: orNull(form.ostIstName),
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
      title="Edit company record"
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
          Verbatim company record. Stated figures never affect verified totals. TIN is write-only
          (current: {customer.tinNumberMasked ?? '—'}); leave blank to keep.
        </p>
        {save.error ? <Alert variant="danger">{save.error.message}</Alert> : null}
        <h3>Primary Member</h3>
        <TextField
          id="ce-ra"
          name="raNumber"
          label="RA NO"
          value={form.raNumber}
          onChange={set('raNumber')}
        />
        <TextField
          id="ce-status"
          name="companyStatus"
          label="STATUS"
          value={form.companyStatus}
          onChange={set('companyStatus')}
        />
        <TextField
          id="ce-cit"
          name="citizenship"
          label="CITIZENSHIP"
          value={form.citizenship}
          onChange={set('citizenship')}
        />
        <TextField
          id="ce-civil"
          name="civilStatus"
          label="CIVIL STATUS"
          value={form.civilStatus}
          onChange={set('civilStatus')}
        />
        <TextField
          id="ce-tin"
          name="tinNumber"
          label="TIN NO. (write-only, blank keeps)"
          value={form.tinNumber}
          onChange={set('tinNumber')}
        />
        <TextField
          id="ce-occ"
          name="occupationBusinessName"
          label="OCCUPATION / BUSINESS NAME"
          value={form.occupationBusinessName}
          onChange={set('occupationBusinessName')}
        />
        <TextField
          id="ce-office"
          name="officeBusinessAddress"
          label="OFFICE / BUSINESS ADDRESS"
          value={form.officeBusinessAddress}
          onChange={set('officeBusinessAddress')}
        />
        <TextField
          id="ce-pos"
          name="employedPosition"
          label="EMPLOYED POSITION"
          value={form.employedPosition}
          onChange={set('employedPosition')}
        />
        <h3>Supplementary Member</h3>
        <TextField
          id="ce-sup-name"
          name="supplementaryFullName"
          label="SUPPLEMENTARY FULL NAME"
          value={form.supplementaryFullName}
          onChange={set('supplementaryFullName')}
        />
        <TextField
          id="ce-sup-addr"
          name="supplementaryAddress"
          label="ADDRESS"
          value={form.supplementaryAddress}
          onChange={set('supplementaryAddress')}
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
            options={[
              { value: '', label: 'Not specified' },
              { value: 'male', label: 'male' },
              { value: 'female', label: 'female' },
              { value: 'other', label: 'other' },
              { value: 'undisclosed', label: 'undisclosed' },
            ]}
          />
        </label>
        <TextField
          id="ce-sup-cit"
          name="supplementaryCitizenship"
          label="CITIZENSHIP"
          value={form.supplementaryCitizenship}
          onChange={set('supplementaryCitizenship')}
        />
        <TextField
          id="ce-sup-civil"
          name="supplementaryCivilStatus"
          label="CIVIL STATUS"
          value={form.supplementaryCivilStatus}
          onChange={set('supplementaryCivilStatus')}
        />
        <TextField
          id="ce-sup-tin"
          name="supplementaryTinNumber"
          label="TIN NO. (write-only, blank keeps)"
          value={form.supplementaryTinNumber}
          onChange={set('supplementaryTinNumber')}
        />
        <TextField
          id="ce-sup-mob"
          name="supplementaryMobile"
          label="MOBILE NO."
          value={form.supplementaryMobile}
          onChange={set('supplementaryMobile')}
        />
        <TextField
          id="ce-sup-email"
          name="supplementaryEmail"
          label="EMAIL ADDRESS"
          value={form.supplementaryEmail}
          onChange={set('supplementaryEmail')}
        />
        <TextField
          id="ce-sup-occ"
          name="supplementaryOccupationBusinessName"
          label="OCCUPATION / BUSINESS NAME"
          value={form.supplementaryOccupationBusinessName}
          onChange={set('supplementaryOccupationBusinessName')}
        />
        <TextField
          id="ce-sup-office"
          name="supplementaryOfficeAddress"
          label="OFFICE / BUSINESS ADDRESS"
          value={form.supplementaryOfficeAddress}
          onChange={set('supplementaryOfficeAddress')}
        />
        <TextField
          id="ce-sup-pos"
          name="supplementaryPosition"
          label="EMPLOYED POSITION"
          value={form.supplementaryPosition}
          onChange={set('supplementaryPosition')}
        />
        <h3>Related Persons and Referral</h3>
        <TextField
          id="ce-ost"
          name="ostIstName"
          label="OST/IST NAME"
          value={form.ostIstName}
          onChange={set('ostIstName')}
        />
        <TextField
          id="ce-svd"
          name="svdName"
          label="SVD"
          value={form.svdName}
          onChange={set('svdName')}
        />
        <TextField
          id="ce-ssm"
          name="ssmName"
          label="SSM"
          value={form.ssmName}
          onChange={set('ssmName')}
        />
        <TextField
          id="ce-sm"
          name="smName"
          label="SM"
          value={form.smName}
          onChange={set('smName')}
        />
        <TextField
          id="ce-ref"
          name="referrerName"
          label="REFERRER"
          value={form.referrerName}
          onChange={set('referrerName')}
        />
        <TextField
          id="ce-viprec"
          name="vipRecommenderName"
          label="VIP RECOMMENDER"
          value={form.vipRecommenderName}
          onChange={set('vipRecommenderName')}
        />
        <TextField
          id="ce-rel-contact"
          name="relatedContactNo"
          label="CONTACT NO."
          value={form.relatedContactNo}
          onChange={set('relatedContactNo')}
        />
        <TextField
          id="ce-rel-email"
          name="relatedEmail"
          label="EMAIL ADDRESS"
          value={form.relatedEmail}
          onChange={set('relatedEmail')}
        />
        <h3>Package and Payment — company stated</h3>
        <TextField
          id="ce-pkg"
          name="statedVipPackage"
          label="VIP PACKAGE"
          value={form.statedVipPackage}
          onChange={set('statedVipPackage')}
        />
        <TextField
          id="ce-terms"
          name="statedPaymentTerms"
          label="PAYMENT TERMS"
          value={form.statedPaymentTerms}
          onChange={set('statedPaymentTerms')}
        />
        <TextField
          id="ce-reg"
          name="statedRegularPrice"
          label="REGULAR PRICE"
          value={form.statedRegularPrice}
          onChange={set('statedRegularPrice')}
        />
        <TextField
          id="ce-disc"
          name="statedDiscount"
          label="DISCOUNT"
          value={form.statedDiscount}
          onChange={set('statedDiscount')}
        />
        <TextField
          id="ce-total"
          name="statedTotalAmount"
          label="TOTAL AMOUNT"
          value={form.statedTotalAmount}
          onChange={set('statedTotalAmount')}
        />
        <TextField
          id="ce-rf"
          name="statedRf"
          label="RF"
          value={form.statedRf}
          onChange={set('statedRf')}
        />
        <TextField
          id="ce-ptype"
          name="statedPaymentType"
          label="PAYMENT TYPE"
          value={form.statedPaymentType}
          onChange={set('statedPaymentType')}
        />
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
          label="DATE"
          optional
          value={form.statedPaymentDate}
          onChange={set('statedPaymentDate')}
        />
      </div>
    </Dialog>
  );
}
