
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  OverflowMenu,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
} from '@afhomes/ui';
import type { Customer, CustomerOnboardingRecovery } from '@afhomes/contracts';
import { customerSellerOptionSchema } from '@afhomes/contracts';

import { requestList } from '../../lib/api/client';
import { useSession } from '../../lib/session';
import { useNavigate } from 'react-router';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './BusinessCustomersPage.module.css';
import {
  anonymizeCustomer,
  deactivateCustomer,
  deleteCustomer,
  getCustomersPage,
  issueCustomerAccountActivation,
} from './services';

/**
 * Customer registration and card application.
 *
 * A seller may choose which customer record, tier, and authorized payment
 * scheme to attach, but never the money: every figure is resolved from the
 * product and frozen server-side. The form therefore has no financial inputs
 * at all, by design - only selections whose economics the server owns.
 */
/** Fixed directory page size. The server also enforces its own max (200). */
const PAGE_SIZE = 10;

export function BusinessCustomersPage() {
  const client = useQueryClient();
  const { user } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);
  // Realtime search: the list follows the settled term automatically (~300ms
  // after the user stops typing). Pagination resets only when the term
  // actually changes - the settle timer also fires after mount and must not
  // clobber a page the user has already turned to.
  const settledSearch = useRef('');
  void useDebouncedValue(search, 300, (term) => {
    const next = term.trim();
    if (next === settledSearch.current) return;
    settledSearch.current = next;
    setApplied(next);
    setPage(0);
  });
  const [filters, setFilters] = useState({
    status: '',
    payment: '',
    tier: '',
    seller: '',
    from: '',
    to: '',
  });
  // Every filter change restarts at the first page.
  const patchFilters = (patch: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };
  const customers = useQuery({
    queryKey: ['business', 'customers', applied, filters, page],
    // Keep the previous page visible while the next one loads: without this
    // the data gap reads as an empty result during every page turn.
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      getCustomersPage({
        search: applied || undefined,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });
  const rows = customers.data?.data ?? [];
  const total = customers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A shrunken result (e.g. a deletion elsewhere) can leave the page past
  // the last one. Correct during render on a total change (the documented
  // previous-value pattern, not an effect); display clamps meanwhile.
  const [prevTotal, setPrevTotal] = useState(total);
  if (prevTotal !== total) {
    setPrevTotal(total);
    if (page > pageCount - 1) setPage(pageCount - 1);
  }
  const safePage = Math.min(page, pageCount - 1);
  const rangeFrom = total === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeTo = Math.min(total, (safePage + 1) * PAGE_SIZE);
  const sellers = useQuery({
    queryKey: ['customer-seller-options'],
    queryFn: () => requestList('/customers/filter-options', customerSellerOptionSchema),
  });
  const canCreate = user?.afHomesPermissions.some(p=>p.moduleKey==='sales.customers' && p.canCreate);
  const canIssueActivation =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;

  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete' | 'anonymize';
    customer: Customer;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [activationResult, setActivationResult] = useState<CustomerOnboardingRecovery | null>(null);
  const [activationCustomerId, setActivationCustomerId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const changeAccount = useMutation({
    mutationFn: async () => {
      if (accountAction?.kind === 'delete') await deleteCustomer(accountAction.customer.id);
      else if (accountAction?.kind === 'anonymize')
        await anonymizeCustomer(accountAction.customer.id);
      else await deactivateCustomer(accountAction!.customer.id);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['business', 'customers'] });
      setAccountAction(null);
      setConfirmation('');
    },
  });
  const issueActivation = useMutation({
    mutationFn: (customerId: string) => issueCustomerAccountActivation(customerId),
    onMutate: (customerId) => {
      setActivationCustomerId(customerId);
      setCopyStatus('');
    },
    onSuccess: (result) => {
      setActivationResult(result);
      setActivationCustomerId(null);
    },
    onError: () => setActivationCustomerId(null),
  });

  const closeActivationResult = () => {
    // The URL contains the plaintext bearer token and is deliberately removed
    // from component state when the one-time dialog closes.
    setActivationResult(null);
    setCopyStatus('');
    issueActivation.reset();
  };

  return (
    <section>
      <PageHeader
        title="Customers"
        description="Customer directory and membership records. Start registration through a new customer application."
        actions={
          <>
            {canCreate && <Button onClick={() => navigate('/admin/customers/applications/new')}>
              New customer application
            </Button>}
          </>
        }
      />

      <FilterBar
        search={
          <SearchField
            label="Search customers"
            placeholder="Name, email, customer or membership number"
            value={search}
            onChange={setSearch}
          />
        }
        filters={
          <>
            <label className={styles.filterLabel}>
              Status
              <Select
                aria-label="Customer status"
                value={filters.status}
                onChange={(e) => patchFilters({ status: e.target.value })}
                options={[
                  { value: '', label: 'All statuses' },
                  ...['prospect', 'active', 'suspended', 'cancelled'].map((s) => ({
                    value: s,
                    label: s[0]!.toUpperCase() + s.slice(1),
                  })),
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              Payment
              <Select
                aria-label="Payment status"
                value={filters.payment}
                onChange={(e) => patchFilters({ payment: e.target.value })}
                options={[
                  { value: '', label: 'All payments' },
                  { value: 'no_payment', label: 'No payment' },
                  { value: 'partially_paid', label: 'Partial payment' },
                  { value: 'fully_paid', label: 'Fully paid' },
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              VIP Tier
              <Select
                aria-label="VIP Tier"
                value={filters.tier}
                onChange={(e) => patchFilters({ tier: e.target.value })}
                options={[
                  { value: '', label: 'All tiers' },
                  ...['GOLD', 'SILVER', 'BRONZE'].map((t) => ({ value: t, label: t })),
                ]}
              />
            </label>
            <label className={styles.filterLabel}>
              Seller
                <Select
                  aria-label="Seller"
                  value={filters.seller}
                  onChange={(e) => patchFilters({ seller: e.target.value })}
                  options={[
                    { value: '', label: 'All sellers' },
                    ...(sellers.data?.map((s) => ({ value: s.id, label: s.name })) ?? []),
                  ]}
                />
              </label>
              <label className={styles.filterLabel}>
                From
                <input
                  aria-label="From date"
                  type="date"
                  value={filters.from}
                  onChange={(e) => patchFilters({ from: e.target.value })}
                />
              </label>
              <label className={styles.filterLabel}>
                To
                <input
                  aria-label="To date"
                  type="date"
                  value={filters.to}
                  onChange={(e) => patchFilters({ to: e.target.value })}
                />
              </label>
            </>
          }
        />

      {customers.isPending ? (
        <p role="status">Loading customers…</p>
      ) : customers.isError ? (
        <ErrorState error={customers.error} onRetry={customers.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No customers found."
          description="Register the first customer to get started."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable records"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>Customer ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr
                  key={customer.id}
                  tabIndex={0}
                  role="link"
                  aria-label={`View customer ${customer.customerNumber}`}
                  onClick={() => navigate(`/admin/customers/${customer.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      navigate(`/admin/customers/${customer.id}`);
                  }}
                  className={styles.clickable}
                >
                  <td className={styles.idCell}>{customer.customerNumber}</td>
                  <td>{customer.fullName}</td>
                  <td className={styles.phoneCell}>{customer.phone}</td>
                  <td>
                    <StatusChip label={customer.status} />
                  </td>
                  <td
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // Only swallow the keys the row itself acts on. Escape
                      // (and Tab) must keep bubbling so the overflow menu's
                      // document-level dialog shell can close on Escape.
                      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                    }}
                  >
                    <OverflowMenu
                      label={`More actions for ${customer.customerNumber}`}
                      items={[
                        ...(canCreate
                          ? [
                              {
                                label: 'New application',
                                icon: 'file-text' as const,
                                disabled: customer.status === 'cancelled',
                                onClick: () => {
                                  navigate(
                                    '/admin/customers/applications/new?customerId=' +
                                      encodeURIComponent(customer.id),
                                  );
                                },
                              },
                            ]
                          : []),
                        ...(canIssueActivation &&
                        customer.hasActiveMembership &&
                        !customer.portalAccountActivated
                          ? [
                              {
                                label:
                                  issueActivation.isPending && activationCustomerId === customer.id
                                    ? 'Issuing activation link…'
                                    : 'Issue / Reissue activation link',
                                icon: 'user-check' as const,
                                disabled:
                                  issueActivation.isPending && activationCustomerId === customer.id,
                                onClick: () => issueActivation.mutate(customer.id),
                              },
                            ]
                          : []),
                        {
                          label: 'Deactivate account',
                          icon: 'user-x' as const,
                          danger: true,
                          disabled:
                            customer.status === 'suspended' || customer.status === 'cancelled',
                          onClick: () => setAccountAction({ kind: 'deactivate', customer }),
                        },
                        ...(user?.roleSlug === 'super_admin'
                          ? [
                              { label: '-', onClick: undefined },
                              {
                                label: 'Anonymize',
                                icon: 'pencil' as const,
                                onClick: () => setAccountAction({ kind: 'anonymize', customer }),
                              },
                              {
                                label: 'Delete permanently',
                                icon: 'trash' as const,
                                danger: true,
                                onClick: () => setAccountAction({ kind: 'delete', customer }),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 ? (
        <nav aria-label="Customers pagination" className={styles.pagination}>
          <span
            role="status"
            aria-label="Customer record range"
            className={styles.paginationRange}
          >
            Showing {rangeFrom}–{rangeTo} of {total}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage === 0}
            onClick={() => setPage(Math.max(0, safePage - 1))}
            aria-label="Previous customers page"
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            aria-label="Next customers page"
          >
            Next
          </Button>
        </nav>
      ) : null}

      <Dialog
        open={activationResult !== null}
        onClose={closeActivationResult}
        title="Customer activation ready"
        footer={<Button onClick={closeActivationResult}>Done</Button>}
      >
        {activationResult ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p>
              {activationResult.emailStatus === 'sent'
                ? 'Activation email sent.'
                : 'Email could not be sent. Copy this link and give it to the customer.'}
            </p>
            <p>
              <strong>This activation link is shown once.</strong> Closing this dialog removes it
              from this screen.
            </p>
            <dl>
              <dt>Email</dt>
              <dd>{activationResult.email}</dd>
              <dt>Expires</dt>
              <dd>{new Date(activationResult.expiresAt).toLocaleString()}</dd>
            </dl>
            <label>
              Activation link
              <input
                aria-label="Customer activation link"
                readOnly
                value={activationResult.activationUrl}
              />
            </label>
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(activationResult.activationUrl);
                  setCopyStatus('Activation link copied.');
                } catch {
                  setCopyStatus('Copy failed. Select and copy the link manually.');
                }
              }}
            >
              Copy activation link
            </Button>
            {copyStatus ? <p role="status">{copyStatus}</p> : null}
          </div>
        ) : null}
      </Dialog>
      {issueActivation.error && !activationResult ? (
        <p role="alert">{issueActivation.error.message}</p>
      ) : null}
      <ConfirmDialog
        open={accountAction !== null}
        onCancel={() => {
          setAccountAction(null);
          setConfirmation('');
        }}
        onConfirm={() => changeAccount.mutate()}
        title={
          accountAction?.kind === 'delete'
            ? 'Permanently Delete Customer Account'
            : accountAction?.kind === 'anonymize'
              ? 'Anonymize Customer Account'
              : 'Deactivate Customer Account'
        }
        message={
          <div>
            <p>
              {accountAction?.kind === 'delete'
                ? 'This permanently removes an unused customer account only when no protected business records exist.'
                : accountAction?.kind === 'anonymize'
                  ? 'Direct profile information and login access will be removed while business history remains.'
                  : 'Customer login access will be removed. Sales, payments, membership, points, and redemption history will remain.'}
            </p>
            {accountAction?.kind !== 'deactivate' ? (
              <label>
                Type DELETE to confirm
                <input
                  aria-label="Type DELETE to confirm customer action"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            ) : null}
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel={
          accountAction?.kind === 'delete'
            ? 'Delete permanently'
            : accountAction?.kind === 'anonymize'
              ? 'Anonymize'
              : 'Confirm'
        }
        confirmDisabled={accountAction?.kind !== 'deactivate' && confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
    </section>
  );
}
