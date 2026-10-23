import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  OverflowMenu,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
} from '@afhomes/ui';
import type { Customer, CustomerOnboardingRecovery } from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './BusinessCustomersPage.module.css';
import { TierBadge } from './TierBadge';
import {

  deactivateCustomer,
  deleteCustomer,
  getCustomersPage,
  issueCustomerAccountActivation,
} from './services';
import { businessKeys } from './queryKeys';
import { CustomerApplicationsPage } from './official-forms-applications';

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
  // The import/export workspace keeps its OWN module, the same as it does in the
  // applications view. Hiding the button is UX only - the server re-checks every
  // call - so this must mirror that page's check exactly, not approximate it.
  const canSeeImportExport =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'governance.customer_import' && permission.canView,
    ) === true;
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  // The Applications view has its own address so the sidebar can highlight it.
  // `?view=` still wins, so an operator on a bookmarked `/admin/customers` link
  // keeps landing on the view they asked for.
  const applications = searchParams.has('view')
    ? searchParams.get('view') === 'applications'
    : pathname.startsWith('/admin/customers/applications');
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
  // THREE filters, and they are the three answers to "who needs chasing":
  // what state the account is in, whether money is still owed, and whose book
  // of business it is. Seller is the only one of the three with no column in
  // the table below, so without it there is no way to see your own customers.
  // VIP tier and the registration date range were dropped: tier is printed on
  // every row, and the table shows no date to filter against.
  const [filters, setFilters] = useState({
    status: '',
    companyStatus: '',
    tier: '',
  });
  // Every filter change restarts at the first page.
  const patchFilters = (patch: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };
  const customers = useQuery({
    queryKey: businessKeys.customers(applied, filters, page),
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
  const canIssueActivation =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;

  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete';
    customer: Customer;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [activationResult, setActivationResult] = useState<CustomerOnboardingRecovery | null>(null);
  const [activationCustomerId, setActivationCustomerId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const changeAccount = useBusinessMutation({
    mutationFn: async () => {
      if (accountAction?.kind === 'delete') await deleteCustomer(accountAction.customer.id);
      else await deactivateCustomer(accountAction!.customer.id);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: businessKeys.customersScope });
      setAccountAction(null);
      setConfirmation('');
    },
  });
  const issueActivation = useBusinessMutation({
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

  // First load skeletonizes the whole page - header, filters, and table -
  // so no static content flashes before the data it describes. Refetches keep
  // the previous page visible via placeholderData and never reach this branch.
  if (customers.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading customers"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 160 }} />
            <Skeleton style={{ height: 40, width: 140 }} />
            <Skeleton style={{ height: 40, width: 180 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  if (applications)
    return (
      <section className={styles.page}>
        <CustomerApplicationsPage />
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Customers"
        description="Customer directory and membership records."
        actions={
          <>
            {canSeeImportExport ? (
              <Button
                variant="secondary"
                onClick={() => navigate('/admin/customers/applications/import-export')}
              >
                Import / Export
              </Button>
            ) : null}
            {/* Creating a customer and building their application are ONE action,
                so this opens the builder rather than a separate create page. */}
            <Button onClick={() => navigate('/admin/customers/new')}>New customer</Button>
          </>
        }
      />

      <FilterBar
        filtersToggleLabel="Expand Filters"
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
                value={filters.companyStatus}
                onChange={(e) => patchFilters({ companyStatus: e.target.value })}
                options={[
                  { value: '', label: 'All payments' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                  { value: 'FULLY PAID', label: 'Fully paid' },
                  { value: 'PARTIAL', label: 'Partial' },
                  { value: 'INSTALLMENT', label: 'Installment' },
                  { value: 'RF ONLY', label: 'RF only' },
                  { value: 'REFUNDED', label: 'Refunded' },
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
                  { value: 'GOLD', label: 'Gold' },
                  { value: 'SILVER', label: 'Silver' },
                  { value: 'BRONZE', label: 'Bronze' },
                ]}
              />
            </label>

          </>
        }
      />

      {customers.isError ? (
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
          aria-busy={customers.isFetching}
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Payment Status</th>
                <th>VIP Tier</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.isFetching && !customers.isPending
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`sk-${i}`} aria-hidden="true">
                      <td><Skeleton style={{ height: 16, width: '60%' }} /></td>
                      <td><Skeleton style={{ height: 16, width: '70%' }} /></td>
                      <td><Skeleton style={{ height: 16, width: '50%' }} /></td>
                      <td><Skeleton style={{ height: 16, width: '60%' }} /></td>
                      <td><Skeleton style={{ height: 16, width: 80 }} /></td>
                    </tr>
                  ))
                : rows.map((customer) => (
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
                  <td data-label="Name">
                    <span className={styles.identityCell}>
                      <span className={styles.identityAvatar} aria-hidden="true">
                        {(customer.fullName.trim().charAt(0) || '•').toUpperCase()}
                      </span>
                      <span className={styles.identityName}>{customer.fullName}</span>
                    </span>
                  </td>
                  <td data-label="Payment Status">
                    {customer.companyStatus ? (
                      <StatusChip label={customer.companyStatus} />
                    ) : (
                      'Not Recorded'
                    )}
                  </td>
                  <td data-label="VIP Tier">
                    <TierBadge tier={customer.tier ?? customer.statedVipPackage} />
                  </td>
                  <td data-label="Status">
                    <StatusChip label={customer.status} />
                  </td>
                  <td
                    data-label="Actions"
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
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="Customers pagination"
          />
        </div>
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
              <dd>{formatDateTime(activationResult.expiresAt)}</dd>
            </dl>
            <TextField
              id="customer-activation-link"
              name="activationLink"
              label="Customer activation link"
              value={activationResult.activationUrl}
              onChange={() => {}}
              readOnly
            />
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
            : 'Deactivate Customer Account'
        }
        message={
          <div>
            <p>
              {accountAction?.kind === 'delete'
                ? 'This permanently removes the customer and ALL of their sales, payments, membership, points, redemptions, applications and ID image. This cannot be undone.'
                : 'Customer login access will be removed. Sales, payments, membership, points, and redemption history will remain.'}
            </p>
            {accountAction?.kind !== 'deactivate' ? (
              <TextField
                id="customer-account-confirm"
                name="accountConfirm"
                label="Type DELETE to confirm customer action"
                value={confirmation}
                onChange={setConfirmation}
              />
            ) : null}
            {changeAccount.error ? <p role="alert">{changeAccount.error.message}</p> : null}
          </div>
        }
        danger
        confirmLabel={
          accountAction?.kind === 'delete' ? 'Delete permanently' : 'Confirm'
        }
        confirmDisabled={accountAction?.kind !== 'deactivate' && confirmation !== 'DELETE'}
        confirmLoading={changeAccount.isPending}
      />
    </section>
  );
}
