import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';

import type { UpdateProfileRequest } from '@jad/contracts';
import {
  ConfirmDialog,
  ErrorState,
  notifySuccess,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@jad/ui';

import { Button } from '../../../components/Button';
import { Alert } from '../../../components/Alert';
import { apiErrorMessage } from '../../../lib/api/errorMessage';
import { orphanMessageFor } from '../../../lib/api/orphan';
import { useMemberProfile } from '../hooks/useMember';
import { formatDate, MEMBER_STATUS_TONE, memberStatusLabel } from '../lib/presentation';
import { updateProfile } from '../services/member';
import { SelectField } from '../../auth/components/SelectField';
import { TextField } from '../../auth/components/TextField';
import styles from './ProfilePage.module.css';

/**
 * Member profile (SCR-MEM-002). Read-only view of `GET /members/:id` (own
 * profile only - object-level, NFR-AUTHZ-002) with an edit mode for mutable
 * fields (`PATCH /me`). Country is immutable (BR-REG-010) and rendered
 * read-only; the referral code is immutable (BR-REF-004) and not editable.
 */
export function ProfilePage() {
  const profileQuery = useMemberProfile();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UpdateProfileRequest | undefined>(undefined);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const initForm = () => {
    const p = profileQuery.data;
    if (!p) return;
    setForm({
      firstName: p.firstName,
      lastName: p.lastName,
      middleInitial: p.middleInitial,
      nameSuffix: p.nameSuffix,
      gender: p.gender,
      address: p.address,
      phone: p.phone,
    });
  };

  const profileMutation = useMutation({
    mutationFn: (input: UpdateProfileRequest) => updateProfile(input),
    onSuccess: () => {
      setEditing(false);
      setError(undefined);
      setForm(undefined);
      notifySuccess({ title: 'Profile updated' });
      void queryClient.invalidateQueries({ queryKey: ['member', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['member', 'sales'] });
    },
    onError: (mutationError) => {
      setError(apiErrorMessage(mutationError, 'We could not save your profile. Please try again.'));
    },
  });

  const isDirty = (() => {
    if (!form || !profileQuery.data) return false;
    const p = profileQuery.data;
    return (
      form.firstName !== p.firstName ||
      form.lastName !== p.lastName ||
      (form.middleInitial ?? '') !== (p.middleInitial ?? '') ||
      (form.nameSuffix ?? '') !== (p.nameSuffix ?? '') ||
      form.gender !== p.gender ||
      (form.address ?? '') !== (p.address ?? '') ||
      form.phone !== p.phone
    );
  })();

  const handleCancel = () => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    setEditing(false);
    setError(undefined);
    setForm(undefined);
  };

  const confirmDiscard = () => {
    setConfirmDiscardOpen(false);
    setEditing(false);
    setError(undefined);
    setForm(undefined);
  };

  if (profileQuery.isLoading) {
    return (
      <section>
        <PageHeader title="Profile" />

        <div className={styles.loading} role="status" aria-live="polite" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      </section>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <section>
        <PageHeader title="Profile" />

        <ErrorState
          error={profileQuery.error}
          title="Could not load your profile"
          message={orphanMessageFor(profileQuery.error)}
          onRetry={() => void profileQuery.refetch()}
        />
      </section>
    );
  }

  const profile = profileQuery.data;

  const setField = <K extends keyof UpdateProfileRequest>(
    field: K,
    value: UpdateProfileRequest[K],
  ) => {
    setForm((current) => ({ ...(current as UpdateProfileRequest), [field]: value }));
  };

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setError(undefined);
    profileMutation.mutate(form);
  };

  return (
    <section>
      <PageHeader
        title="Profile"
        description="Your member details."
        actions={
          !editing ? (
            <Button
              variant="secondary"
              onClick={() => {
                initForm();
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert variant="danger" title="We could not save your profile">
          {error}
        </Alert>
      ) : null}

      {editing && form ? (
        <div className={styles.editCard}>
          <form className={styles.form} noValidate onSubmit={onSave}>
            <div className={styles.gridTwo}>
              <TextField
                id="profile-firstName"
                name="firstName"
                label="First name"
                value={form.firstName}
                onChange={(value) => setField('firstName', value)}
                autoComplete="given-name"
                placeholder="Juan"
                maxLength={30}
              />
              <TextField
                id="profile-lastName"
                name="lastName"
                label="Last name"
                value={form.lastName}
                onChange={(value) => setField('lastName', value)}
                autoComplete="family-name"
                placeholder="Dela Cruz"
                maxLength={30}
              />
            </div>
            <div className={styles.gridThree}>
              <TextField
                id="profile-middleInitial"
                name="middleInitial"
                label="Middle initial"
                optional
                value={form.middleInitial ?? ''}
                onChange={(value) => setField('middleInitial', value.slice(0, 1))}
                autoComplete="off"
                placeholder="M"
                maxLength={1}
                hint="Single letter (A-Z)"
              />
              <TextField
                id="profile-nameSuffix"
                name="nameSuffix"
                label="Name suffix"
                optional
                value={form.nameSuffix ?? ''}
                onChange={(value) => setField('nameSuffix', value)}
                autoComplete="off"
                placeholder="Jr."
                maxLength={10}
              />
              <TextField
                id="profile-phone"
                name="phone"
                type="tel"
                label="Phone number"
                value={form.phone}
                onChange={(value) => setField('phone', value)}
                autoComplete="tel"
                inputMode="tel"
                placeholder="+63 917 555 0199"
                hint="+63 9xx • 11 digits"
              />
            </div>
            <SelectField
              id="profile-gender"
              name="gender"
              label="Gender"
              value={form.gender}
              onChange={(value) => setField('gender', value)}
              options={(profileQuery.data?.gender
                ? [profile.gender, 'Male', 'Female', 'LGBT']
                : ['Male', 'Female', 'LGBT']
              )
                .filter((gender, index, all) => all.indexOf(gender) === index)
                .map((gender) => ({ value: gender, label: gender }))}
            />
            <TextField
              id="profile-address"
              name="address"
              label="Address"
              optional
              value={form.address ?? ''}
              onChange={(value) => setField('address', value)}
              autoComplete="street-address"
              placeholder="123 Mabini St, Pasig City"
            />
            <div className={styles.formActions}>
              <Button
                type="submit"
                loading={profileMutation.isPending}
                disabled={profileMutation.isPending}
              >
                Save changes
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancel}
                disabled={profileMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <dl className={styles.details}>
          <div className={styles.item}>
            <dt>Name</dt>
            <dd>
              {profile.firstName} {profile.middleInitial ? `${profile.middleInitial}. ` : ''}
              {profile.lastName}
              {profile.nameSuffix ? `, ${profile.nameSuffix}` : ''}
            </dd>
          </div>
          <div className={styles.item}>
            <dt>Email</dt>
            <dd>{profile.email}</dd>
          </div>
          <div className={styles.item}>
            <dt>Phone</dt>
            <dd>{profile.phone}</dd>
          </div>
          <div className={styles.item}>
            <dt>Date of birth</dt>
            <dd>
              {formatDate(profile.dateOfBirth)} (age {profile.age})
            </dd>
          </div>
          <div className={styles.item}>
            <dt>Gender</dt>
            <dd>{profile.gender}</dd>
          </div>
          <div className={styles.item}>
            <dt>Country</dt>
            <dd>
              {profile.countryName} <span className={styles.immutable}>(immutable)</span>
            </dd>
          </div>
          {profile.address ? (
            <div className={styles.item}>
              <dt>Address</dt>
              <dd>{profile.address}</dd>
            </div>
          ) : null}
          <div className={styles.item}>
            <dt>Program</dt>
            <dd>
              {profile.program.name} ({profile.program.code})
            </dd>
          </div>
          <div className={styles.item}>
            <dt>Status</dt>
            <dd>
              <StatusChip
                label={memberStatusLabel(profile.status)}
                tone={MEMBER_STATUS_TONE[profile.status]}
              />
            </dd>
          </div>
          <div className={styles.item}>
            <dt>Referral code</dt>
            <dd className={styles.referralCell}>
              <span className={styles.code}>{profile.referralCode}</span>{' '}
              <span className={styles.immutable}>(immutable)</span>{' '}
              <button
                type="button"
                className={styles.copyButton}
                aria-live="polite"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(profile.referralCode);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </dd>
          </div>
        </dl>
      )}

      <ConfirmDialog
        open={confirmDiscardOpen}
        onCancel={() => setConfirmDiscardOpen(false)}
        onConfirm={confirmDiscard}
        title="Discard changes?"
        message="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />
    </section>
  );
}
