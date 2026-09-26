import { Link, useLocation, useSearchParams } from 'react-router';

import { useQuery } from '@tanstack/react-query';
import { getGlobalCmsPublic, getRegisterCmsPublic } from '@/lib/cms';
import { Alert } from '../../../components/Alert';
import { AUTH } from '../content';
import { AuthLayout } from '../components/AuthLayout';
import styles from './RegistrationStatusPage.module.css';

/**
 * Application status (SCR-AUTH-004). Reached after email verification:
 * the application is `Pending` - email verified, awaiting JA&D review.
 * Nothing here invents approvals or timeframes (BR-AUTH-002 statuses only).
 */
export function RegistrationStatusPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const email =
    (location.state as { email?: string } | null)?.email ??
    searchParams.get('email') ??
    (() => {
      try {
        return sessionStorage.getItem('jad:register:email') ?? '';
      } catch {
        return '';
      }
    })();
  const { data: globalCms } = useQuery({
    queryKey: ['cms', 'global'],
    queryFn: getGlobalCmsPublic,
    staleTime: 0,
  });
  const { data: registerCms } = useQuery({
    queryKey: ['cms', 'register'],
    queryFn: getRegisterCmsPublic,
    staleTime: 0,
  });
  const cmsStatus = (
    registerCms as
      | {
          status?: {
            eyebrow?: string;
            title?: string;
            lead?: string;
            brandTitle?: string;
            brandLead?: string;
          };
        }
      | undefined
  )?.status;
  const statusCopy = {
    eyebrow: cmsStatus?.eyebrow ?? AUTH.status.eyebrow,
    title: cmsStatus?.title ?? AUTH.status.title,
    lead: cmsStatus?.lead ?? 'Your application is being reviewed.',
    brandTitle: cmsStatus?.brandTitle ?? AUTH.status.brandTitle,
    brandLead: cmsStatus?.brandLead ?? AUTH.status.brandLead,
    pending: AUTH.status.pending,
    steps: AUTH.status.steps,
  };
  const statusImage =
    (registerCms as { image?: { id: string; alt: string } } | undefined)?.image ??
    AUTH.images.login;
  const brandMark = globalCms?.brandMark ?? null;

  return (
    <AuthLayout
      eyebrow={statusCopy.eyebrow}
      title={statusCopy.title}
      lead={statusCopy.lead}
      brandTitle={statusCopy.brandTitle}
      brandLead={statusCopy.brandLead}
      image={statusImage}
      brandMark={brandMark}
    >
      <div className={styles.resultPanel}>
        <Alert variant="success" title={statusCopy.pending.title}>
          {statusCopy.pending.message}
        </Alert>

        <ol className={styles.steps}>
          {statusCopy.steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepTitle}>{step.title}</span>
                <span className={styles.stepBody}>{step.body}</span>
              </span>
            </li>
          ))}
        </ol>

        {email ? <p className={styles.email}>Application for {email}</p> : null}

        <div className={styles.submitRow}>
          <Link className={styles.signInLink} to={AUTH.loginPath}>
            {AUTH.status.signInLabel}
          </Link>
        </div>

        <p className={styles.note}>
          Questions?{' '}
          <Link className={styles.promptLink} to={AUTH.supportPath}>
            Contact us
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
