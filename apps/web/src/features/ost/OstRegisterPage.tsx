import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  normalizeAddressField,
  normalizeEmail,
  normalizePersonName,
  normalizePhilippinePhone,
  type SubmitOstApplicationRequest,
} from '@jad/contracts';
import { NormalizedInput, AuthLayout, Button } from '@jad/ui';

import { resolveOstReferral, submitOstApplication } from './services';
import authStyles from '../customer/auth.module.css';

/**
 * Public OST registration. The referral code arrives as `?code=` (from the
 * SM's shared link or QR) and the sponsor is resolved BEFORE the form can be
 * submitted. The form carries no sponsor field - hidden or otherwise - so the
 * code cannot be swapped for a different sponsor at submit time.
 */
export function OstRegisterPage() {
  const [params] = useSearchParams();
  const code = (params.get('code') ?? '').trim();

  const resolution = useQuery({
    queryKey: ['ost', 'referral', code],
    queryFn: () => resolveOstReferral(code),
    enabled: code.length > 0,
    retry: false,
  });

  const [form, setForm] = useState({
    firstName: '',
    middleName: '',
    lastName: '',
    email: '',
    phone: '',
    birthDate: '',
    line1: '',
    city: '',
    province: '',
    postalCode: '',
  });
  const [error, setError] = useState<string | null>(null);

  const submission = useMutation({
    mutationFn: (body: SubmitOstApplicationRequest) => submitOstApplication(body),
    onSuccess: () => setError(null),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Submission failed.'),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    void submission
      .mutateAsync({
        referralCode: code,
        firstName: normalizePersonName(form.firstName),
        middleName: form.middleName.trim() ? normalizePersonName(form.middleName) : undefined,
        lastName: normalizePersonName(form.lastName),
        email: normalizeEmail(form.email) ?? form.email.trim(),
        phone: normalizePhilippinePhone(form.phone) ?? form.phone.trim(),
        birthDate: form.birthDate,
        address: {
          line1: normalizeAddressField(form.line1),
          city: normalizeAddressField(form.city),
          province: normalizeAddressField(form.province),
          postalCode: form.postalCode.trim() || undefined,
          countryCode: 'PH',
        },
      })
      .catch(() => {
        // Surfaced through `submission.error` below; no navigation on failure.
      });
  };

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({
      ...current,
      [key]: event.target.value,
    }));

  if (submission.isSuccess) {
    return (
      <AuthLayout
        eyebrow="AF Homes Ecofarm"
        title="Application received"
        brandTitle="Sell the farm you believe in."
        brandLead="Your application is pending review under your sponsor."
        wide
      >
        <div>
          <p className={authStyles.body}>
            Your OST application is pending review under{' '}
            {resolution.data?.sponsorName ?? 'your sponsor'}. Your reference is{' '}
            <strong>{submission.data.referenceNumber}</strong>. Keep it for follow-ups.
          </p>
          <p className={authStyles.body}>
            Approval is a manual administrative review. You will be invited to create your seller
            account only after approval - this page creates no account and no login.
          </p>
          <p className={authStyles.body}>
            <Link to="/">Back to the site</Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="AF Homes Ecofarm"
      title="Apply as an OST seller"
      lead="Register under your Sales Manager's referral code."
      brandTitle="Sell the farm you believe in."
      brandLead="Your pipeline, your referral code, and your network - once your application is approved."
      wide
    >
      <div>
        {!code ? (
          <p className={authStyles.error} role="alert">
            This page needs a referral code. Ask your Sales Manager for their registration link.
          </p>
        ) : resolution.isPending ? (
          <p role="status">Checking your referral code…</p>
        ) : resolution.isError ? (
          <p className={authStyles.error} role="alert">
            {resolution.error instanceof Error
              ? resolution.error.message
              : 'This referral code is not valid.'}
          </p>
        ) : (
          <p className={authStyles.body}>
            You are registering under <strong>{resolution.data.sponsorName}</strong>. This sponsor
            is fixed and cannot be changed.
          </p>
        )}

        {error ? (
          <p className={authStyles.error} role="alert">
            {error}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className={authStyles.form}>
          <label className={authStyles.label} htmlFor="ost-first">
            First name
          </label>
          <NormalizedInput
            suggestName
            id="ost-first"
            className={authStyles.input}
            value={form.firstName}
            onChange={set('firstName')}
            required
            maxLength={80}
            autoComplete="given-name"
          />
          <label className={authStyles.label} htmlFor="ost-middle">
            Middle name (optional)
          </label>
          <NormalizedInput
            suggestName
            id="ost-middle"
            className={authStyles.input}
            value={form.middleName}
            onChange={set('middleName')}
            maxLength={80}
            autoComplete="additional-name"
          />
          <label className={authStyles.label} htmlFor="ost-last">
            Last name
          </label>
          <NormalizedInput
            suggestName
            id="ost-last"
            className={authStyles.input}
            value={form.lastName}
            onChange={set('lastName')}
            required
            maxLength={80}
            autoComplete="family-name"
          />
          <label className={authStyles.label} htmlFor="ost-email">
            Email
          </label>
          <input
            id="ost-email"
            className={authStyles.input}
            type="email"
            value={form.email}
            onChange={set('email')}
            required
            maxLength={254}
            autoComplete="email"
          />
          <label className={authStyles.label} htmlFor="ost-phone">
            Phone
          </label>
          <input
            id="ost-phone"
            className={authStyles.input}
            value={form.phone}
            onChange={set('phone')}
            required
            autoComplete="tel"
            placeholder="+639171234567"
          />
          <p className={authStyles.hint}>7-15 digits, optionally starting with +.</p>
          <label className={authStyles.label} htmlFor="ost-dob">
            Date of birth
          </label>
          <input
            id="ost-dob"
            className={authStyles.input}
            type="date"
            value={form.birthDate}
            onChange={set('birthDate')}
            required
          />
          <label className={authStyles.label} htmlFor="ost-line1">
            Street address
          </label>
          <NormalizedInput
            normalize={(value) => value.toUpperCase()}
            id="ost-line1"
            className={authStyles.input}
            value={form.line1}
            onChange={set('line1')}
            required
            maxLength={200}
            autoComplete="street-address"
          />
          <label className={authStyles.label} htmlFor="ost-city">
            City
          </label>
          <NormalizedInput
            normalize={(value) => value.toUpperCase()}
            id="ost-city"
            className={authStyles.input}
            value={form.city}
            onChange={set('city')}
            required
            maxLength={100}
            autoComplete="address-level2"
          />
          <label className={authStyles.label} htmlFor="ost-province">
            Province
          </label>
          <NormalizedInput
            normalize={(value) => value.toUpperCase()}
            id="ost-province"
            className={authStyles.input}
            value={form.province}
            onChange={set('province')}
            required
            maxLength={100}
            autoComplete="address-level1"
          />
          <label className={authStyles.label} htmlFor="ost-postal">
            Postal code (optional)
          </label>
          <NormalizedInput
            normalize={(value) => value.toUpperCase()}
            id="ost-postal"
            className={authStyles.input}
            value={form.postalCode}
            onChange={set('postalCode')}
            maxLength={20}
            autoComplete="postal-code"
          />
          <Button type="submit" disabled={!resolution.data || submission.isPending}>
            {submission.isPending ? 'Submitting…' : 'Submit application'}
          </Button>
        </form>

        <p className={authStyles.body}>
          <Link to="/">Back to the site</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
