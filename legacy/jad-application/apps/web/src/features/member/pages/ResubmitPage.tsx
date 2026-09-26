import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { useSession } from '../../../lib/session';
import { notifySuccess, PageHeader, Skeleton } from '@jad/ui';

import { Alert } from '../../../components/Alert';
import { RegistrationForm } from '../../auth/components/RegistrationForm';
import type { RegistrationDraft } from '../../auth/registrationValidation';
import { resubmitApplication } from '../../auth/services/auth';
import { getProfile } from '../services/member';
import styles from './ResubmitPage.module.css';

/**
 * Resubmit application (SCR-AUTH-005, FR-REG-005) - for REJECTED members only.
 * Corrects the flagged details (profile, qualification, ID) and returns the
 * application to `Pending` via `POST /me/resubmit` (unlimited resubmissions,
 * BR-REG-005). Reuses the shared multi-step RegistrationForm.
 */
export function ResubmitPage() {
  const { user } = useSession();
  const [submitted, setSubmitted] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['member-profile', user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: Boolean(user?.id),
  });

  if (user?.status !== 'REJECTED') {
    return (
      <section>
        <PageHeader
          title="Resubmit your application"
          description="Your application is not in a state that can be resubmitted."
        />
      </section>
    );
  }

  if (profileQuery.isLoading) {
    return (
      <section>
        <PageHeader
          title="Resubmit your application"
          description="Loading your application\u2026"
        />
        <div className={styles.loading} role="status">
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
        <PageHeader title="Resubmit your application" />
        <Alert variant="danger" title="We could not load your application">
          Please try again shortly, or contact us for assistance.
        </Alert>
      </section>
    );
  }

  const profile = profileQuery.data;
  const initialDraft: Partial<RegistrationDraft> = {
    programId: profile.program.id,
    firstName: profile.firstName,
    middleInitial: profile.middleInitial,
    noMiddleInitial: !profile.middleInitial?.trim(),
    lastName: profile.lastName,
    nameSuffix: profile.nameSuffix,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    countryCode: profile.countryCode,
    address: profile.address,
    provinceCode: profile.provinceCode,
    cityCode: profile.cityCode,
    barangayCode: profile.barangayCode,
    region: profile.regionName,
    city: profile.cityName,
    phone: profile.phone,
    referralCode: profile.referralCode,
  };

  if (submitted) {
    return (
      <section>
        <PageHeader
          title="Application resubmitted"
          description="Thank you for correcting your application."
        />
        <div className={styles.actionRow}>
          <Link className={styles.dashboardLink} to="/member">
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="Resubmit your application"
        description="Correct the flagged details below to resubmit your application for review."
      />
      <div className={styles.formWrap}>
        <RegistrationForm
          mode="resubmit"
          initialDraft={initialDraft}
          submit={async (payload) => {
            await resubmitApplication(payload);
            notifySuccess({
              title: 'Resubmitted for review',
              message: 'Your corrected application is now Pending and will be reviewed by JA&D.',
            });
            setSubmitted(true);
          }}
        />
      </div>
    </section>
  );
}
