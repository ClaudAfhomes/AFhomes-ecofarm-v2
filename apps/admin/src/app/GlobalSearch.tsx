import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useSession } from '../lib/session';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { canViewModule } from './navigation';
import { getCustomerApplicationsPage, getCustomersPage } from '../features/business/services';
import { getReservationAgreementsPage } from '../features/business/services';

/**
 * One search box that jumps to the record. Uses ONLY existing list/search
 * endpoints: customers (name, customer ID/code, email), customer applications
 * (application number) and reservation agreements (RA number). Phone, AA
 * number and VIP Card ID have no existing customer search endpoint, so they are
 * deliberately not matched here. UX only: each endpoint authorizes itself.
 */
export function GlobalSearch() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const settled = useDebouncedValue(term.trim(), 300);
  const active = settled.length >= 2;
  const permissions = user?.afHomesPermissions;
  const canCustomers = canViewModule(permissions, 'sales.customers');
  const canSales = canViewModule(permissions, 'sales.card_sales');

  const customers = useQuery({
    queryKey: ['global-search', 'customers', settled],
    queryFn: () => getCustomersPage({ search: settled, limit: 5 }),
    enabled: active && canCustomers,
    retry: false,
  });
  const applications = useQuery({
    queryKey: ['global-search', 'applications', settled],
    queryFn: () => getCustomerApplicationsPage({ search: settled, limit: 5 }),
    enabled: active && canCustomers,
    retry: false,
  });
  const reservations = useQuery({
    queryKey: ['global-search', 'reservations', settled],
    queryFn: () => getReservationAgreementsPage({ search: settled, limit: 5 }),
    enabled: active && canSales,
    retry: false,
  });

  const results = [
    ...(customers.data?.data ?? []).map((c) => ({
      key: `c-${c.id}`,
      label: `${c.fullName ?? c.customerNumber} · Customer`,
      to: `/admin/customers/${c.id}`,
    })),
    ...(applications.data?.data ?? []).map((a) => ({
      key: `a-${a.id}`,
      label: `${a.applicationNumber} · Application`,
      to: `/admin/customers/applications/${a.id}`,
    })),
    ...(reservations.data?.data ?? []).map((r) => ({
      key: `r-${r.id}`,
      label: `${r.reservationNumber} · Reservation`,
      to: `/admin/sales/reservations/${r.id}`,
    })),
  ];
  if (!canCustomers && !canSales) return null;
  const busy = customers.isFetching || applications.isFetching || reservations.isFetching;
  return (
    <div role="search" aria-label="Global search">
      <input
        type="search"
        aria-label="Search customers, applications and reservations"
        placeholder="Search name, ID, application or RA number"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results[0]) {
            navigate(results[0].to);
            setTerm('');
          }
        }}
      />
      {active && !busy && results.length === 0 ? <p role="status">No match.</p> : null}
      {active && results.length ? (
        <ul aria-label="Search results">
          {results.map((result) => (
            <li key={result.key}>
              <Link to={result.to} onClick={() => setTerm('')}>
                {result.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
