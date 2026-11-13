import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatCountOrDash } from '@afhomes/shared';
import { useSession } from '../../lib/session';
import { canViewModule } from '../../app/navigation';
import { getActivationQueue, getCustomerApplicationsPage } from '../business/services';
import { applicationNextStep } from '../business/next-step';
import { getAfHomesDashboardQueues } from './services';

/**
 * Role-based "My work today", built only from existing queue/list endpoints
 * (server counts; nothing is totalled in the browser). UX only: every
 * linked screen and every endpoint re-checks authorization.
 */
export function MyWorkToday() {
  const { user } = useSession();
  const permissions = user?.afHomesPermissions;
  const role = user?.roleSlug ?? '';
  const isFinance = canViewModule(permissions, 'finance.payment_verification');
  const canActivate = canViewModule(permissions, 'finance.card_activation');
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSm = role === 'sales_manager';

  const queues = useQuery({
    queryKey: ['my-work', 'queues'],
    queryFn: getAfHomesDashboardQueues,
    enabled: isFinance,
    retry: false,
  });
  const activation = useQuery({
    queryKey: ['my-work', 'activation'],
    queryFn: () => getActivationQueue(''),
    enabled: canActivate,
    retry: false,
  });
  const awaitingApproval = useQuery({
    queryKey: ['my-work', 'awaiting-approval'],
    queryFn: () => getCustomerApplicationsPage({ status: 'submitted', limit: 1 }),
    enabled: isAdmin,
    retry: false,
  });
  const ownApplications = useQuery({
    queryKey: ['my-work', 'own-applications'],
    queryFn: () => getCustomerApplicationsPage({ queue: 'application_work', limit: 50 }),
    enabled: isSm,
    retry: false,
  });

  const readyToActivate = activation.data?.items.filter((item) => item.activatable).length;
  const own = (ownApplications.data?.data ?? []).filter((app) => app.createdBy === user?.id);
  const cards: { key: string; label: string; value: string; to: string }[] = [];
  if (isFinance && queues.data?.paymentVerification != null)
    cards.push({
      key: 'payments',
      label: 'Payments waiting',
      value: formatCountOrDash(queues.data.paymentVerification),
      to: '/admin/finance/payments',
    });
  if (canActivate && readyToActivate !== undefined)
    cards.push({
      key: 'activate',
      label: 'Ready to activate',
      value: formatCountOrDash(readyToActivate),
      to: '/admin/finance/activation',
    });
  if (isAdmin && awaitingApproval.data)
    cards.push({
      key: 'approval',
      label: 'Applications awaiting approval',
      value: formatCountOrDash(awaitingApproval.data.total),
      to: '/admin/customers/applications',
    });
  if (!cards.length && !(isSm && own.length)) return null;
  return (
    <section aria-label="My work today">
      <h2>My work today</h2>
      {cards.length ? (
        <ul>
          {cards.map((card) => (
            <li key={card.key}>
              <Link to={card.to}>
                {card.label}: <strong>{card.value}</strong>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {isSm && own.length ? (
        <>
          <h3>My applications and what each waits on</h3>
          <ul>
            {own.map((app) => {
              const step = applicationNextStep(app);
              return (
                <li key={app.id}>
                  {step.to ? (
                    <Link to={step.to}>{app.applicationNumber}</Link>
                  ) : (
                    app.applicationNumber
                  )}{' '}
                  — {app.status}: {step.label}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
