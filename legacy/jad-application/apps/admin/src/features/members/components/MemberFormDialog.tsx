import { useEffect, useState } from 'react';

import { Button, Dialog, Select } from '@jad/ui';
import type { AdminMember } from '@jad/contracts';

import { createMember } from '../repositories/memberRepository';
import { updateMember } from '../repositories/memberRepository';
import { useQueryClient } from '@tanstack/react-query';

interface MemberFormDialogProps {
  open: boolean;
  onClose: () => void;
  member?: AdminMember | null;
}

const COUNTRY_OPTIONS = [
  { value: 'PH|Philippines', label: 'Philippines (PH)' },
  { value: 'US|United States', label: 'United States (US)' },
  { value: 'JP|Japan', label: 'Japan (JP)' },
  { value: 'AE|United Arab Emirates', label: 'United Arab Emirates (AE)' },
  { value: 'ES|Spain', label: 'Spain (ES)' },
  { value: 'SG|Singapore', label: 'Singapore (SG)' },
];

export function MemberFormDialog({ open, onClose, member }: MemberFormDialogProps) {
  const isEdit = Boolean(member);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    gender: '',
    customGender: '',
    address: '',
    country: 'PH|Philippines',
    programCode: 'ABROAD',
    dateOfBirth: '1992-01-01',
    temporaryPassword: '',
    referralCode: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (member) {
      const isOther = !['Male', 'Female'].includes(member.gender);
      setForm({
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        phone: member.phone,
        gender: isOther ? 'Others' : member.gender,
        customGender: isOther ? member.gender : '',
        address: member.address ?? '',
        country: `${member.countryCode}|${member.countryName}`,
        programCode: member.program.code,
        dateOfBirth: member.dateOfBirth,
        temporaryPassword: '',
        referralCode: '',
      });
    } else {
      setForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        gender: '',
        customGender: '',
        address: '',
        country: 'PH|Philippines',
        programCode: 'ABROAD',
        dateOfBirth: '1992-01-01',
        temporaryPassword: '',
        referralCode: '',
      });
    }
    setErrors({});
    setSubmitError(undefined);
  }, [member, open]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'First name is required';
    if (!form.lastName.trim()) e.lastName = 'Last name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email';
    if (!form.phone.trim()) e.phone = 'Phone is required';
    else if (!/^\+?[\d\s\-()]{7,20}$/.test(form.phone.trim()))
      e.phone = 'Enter a valid phone number';
    if (!form.gender.trim()) e.gender = 'Gender is required';
    if (form.gender === 'Others' && !form.customGender.trim())
      e.customGender = 'Please specify gender';
    if (!form.country) e.country = 'Country is required';
    if (!form.dateOfBirth) e.dateOfBirth = 'Date of birth is required';
    if (!isEdit && !form.temporaryPassword.trim())
      e.temporaryPassword = 'Temporary password is required';
    if (!isEdit && form.temporaryPassword.trim().length < 8)
      e.temporaryPassword = 'Password must be at least 8 characters';
    return e;
  };

  const handleSubmit = async () => {
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setSubmitError(undefined);
    setIsPending(true);
    try {
      const [countryCode, countryName] = form.country.split('|');
      const resolvedGender = form.gender === 'Others' ? form.customGender.trim() : form.gender;
      if (isEdit && member) {
        await updateMember(member.id, {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          gender: resolvedGender,
          address: form.address.trim() || undefined,
        } as never);
        await qc.invalidateQueries({ queryKey: ['admin', 'member', member.id] });
        await qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      } else {
        const sponsorCode = form.referralCode.trim();
        await createMember({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          gender: resolvedGender,
          address: form.address.trim() || undefined,
          countryCode: countryCode!,
          countryName: countryName!,
          programCode: form.programCode,
          dateOfBirth: form.dateOfBirth,
          temporaryPassword: form.temporaryPassword.trim(),
          ...(sponsorCode ? { referralCode: sponsorCode } : {}),
        });
        await qc.invalidateQueries({ queryKey: ['admin', 'members'] });
      }
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Member' : 'Create Member'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isPending}>
            {isEdit ? 'Save changes' : 'Create member'}
          </Button>
        </>
      }
    >
      <div
        data-testid="member-form-fields"
        style={{
          display: 'grid',
          gap: 'var(--space-3)',
          minWidth: 'min(320px, 100%)',
          maxWidth: '100%',
        }}
      >
        {submitError ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '10px 12px',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              color: 'var(--color-danger)',
            }}
          >
            {submitError}
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-firstName"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            First Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="member-firstName"
            value={form.firstName}
            onChange={(e) => setForm((s) => ({ ...s, firstName: e.target.value }))}
            placeholder="Juan"
            aria-label="First Name"
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? 'member-firstName-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.firstName ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.firstName ? (
            <span
              id="member-firstName-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.firstName}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-lastName"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Last Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="member-lastName"
            value={form.lastName}
            onChange={(e) => setForm((s) => ({ ...s, lastName: e.target.value }))}
            placeholder="Dela Cruz"
            aria-label="Last Name"
            aria-invalid={Boolean(errors.lastName)}
            aria-describedby={errors.lastName ? 'member-lastName-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.lastName ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.lastName ? (
            <span
              id="member-lastName-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.lastName}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="member-email" style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Email <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="member-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            placeholder="juan.delacruz@example.com"
            aria-label="Email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'member-email-error' : undefined}
            disabled={isEdit}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.email ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              background: isEdit ? 'var(--color-bg-surface)' : 'var(--color-bg-surface-raised)',
            }}
          />
          {errors.email ? (
            <span
              id="member-email-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.email}
            </span>
          ) : isEdit ? (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Email cannot be changed
            </span>
          ) : null}
        </div>

        {!isEdit ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label
              htmlFor="member-temporaryPassword"
              style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
            >
              Temporary Password <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="member-temporaryPassword"
              type="password"
              value={form.temporaryPassword}
              onChange={(e) => setForm((s) => ({ ...s, temporaryPassword: e.target.value }))}
              placeholder="Min. 8 characters"
              aria-label="Temporary Password"
              aria-invalid={Boolean(errors.temporaryPassword)}
              aria-describedby={
                errors.temporaryPassword ? 'member-temporaryPassword-error' : undefined
              }
              style={{
                minHeight: 44,
                padding: '10px 12px',
                border: `1px solid ${errors.temporaryPassword ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-s)',
              }}
            />
            {errors.temporaryPassword ? (
              <span
                id="member-temporaryPassword-error"
                style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
                role="alert"
              >
                {errors.temporaryPassword}
              </span>
            ) : null}
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Member can change this after first login
            </span>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="member-phone" style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Phone <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="member-phone"
            value={form.phone}
            onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
            placeholder="+63 917 123 4567"
            aria-label="Phone"
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? 'member-phone-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.phone ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.phone ? (
            <span
              id="member-phone-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.phone}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-gender"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Gender <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <select
            id="member-gender"
            value={form.gender}
            onChange={(e) => setForm((s) => ({ ...s, gender: e.target.value, customGender: '' }))}
            aria-label="Gender"
            aria-invalid={Boolean(errors.gender)}
            aria-describedby={errors.gender ? 'member-gender-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.gender ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              background: 'var(--color-bg-surface-raised)',
            }}
          >
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Others">Others</option>
          </select>
          {errors.gender ? (
            <span
              id="member-gender-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.gender}
            </span>
          ) : null}
        </div>

        {form.gender === 'Others' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label
              htmlFor="member-customGender"
              style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
            >
              Specify Gender <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              id="member-customGender"
              value={form.customGender}
              onChange={(e) => setForm((s) => ({ ...s, customGender: e.target.value }))}
              placeholder="Enter gender"
              aria-label="Specify Gender"
              aria-invalid={Boolean(errors.customGender)}
              aria-describedby={errors.customGender ? 'member-customGender-error' : undefined}
              style={{
                minHeight: 44,
                padding: '10px 12px',
                border: `1px solid ${errors.customGender ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-s)',
              }}
            />
            {errors.customGender ? (
              <span
                id="member-customGender-error"
                style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
                role="alert"
              >
                {errors.customGender}
              </span>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-country"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Country <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Select
            aria-label="Country"
            value={form.country}
            onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
            options={COUNTRY_OPTIONS}
          />
          {isEdit ? (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Country is immutable per BR-REG-010
            </span>
          ) : null}
          {errors.country ? (
            <span
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.country}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-program"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Program
          </label>
          <Select
            aria-label="Program"
            value={form.programCode}
            onChange={(e) => setForm((s) => ({ ...s, programCode: e.target.value }))}
            options={[
              { value: 'ABROAD', label: 'Abroad' },
              { value: 'DOMESTIC', label: 'Domestic' },
            ]}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-dateOfBirth"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Date of Birth <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="member-dateOfBirth"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm((s) => ({ ...s, dateOfBirth: e.target.value }))}
            aria-label="Date of Birth"
            aria-invalid={Boolean(errors.dateOfBirth)}
            aria-describedby={errors.dateOfBirth ? 'member-dateOfBirth-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.dateOfBirth ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.dateOfBirth ? (
            <span
              id="member-dateOfBirth-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.dateOfBirth}
            </span>
          ) : null}
        </div>

        {!isEdit ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label
              htmlFor="member-referralCode"
              style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
            >
              Sponsor referral code (optional)
            </label>
            <input
              id="member-referralCode"
              type="text"
              value={form.referralCode}
              onChange={(e) => setForm((s) => ({ ...s, referralCode: e.target.value }))}
              aria-label="Sponsor referral code"
              placeholder="e.g. JAD-DOE12"
              style={{
                minHeight: 44,
                padding: '10px 12px',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-s)',
              }}
            />
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Links this member under an active, qualified sponsor for genealogy and referral
              commissions.
            </span>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="member-address"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Address
          </label>
          <input
            id="member-address"
            value={form.address}
            onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
            placeholder="123 Mabini St, Quezon City"
            aria-label="Address"
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
        </div>

        {submitError ? (
          <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-body-s)' }} role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
