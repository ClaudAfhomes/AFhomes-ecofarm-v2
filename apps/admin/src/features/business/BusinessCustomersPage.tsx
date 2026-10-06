
import { useState } from 'react';
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
  StatusChip,
} from '@afhomes/ui';
import type { Customer, CustomerOnboardingRecovery } from '@afhomes/contracts';
import {
  CUSTOMER_CATEGORY_LABELS,
  resolveCustomerCategory,
  customerSellerOptionSchema,
} from '@afhomes/contracts';

import { requestList } from '../../lib/api/client';
import { useSession } from '../../lib/session';
import { useNavigate } from 'react-router';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import {
  anonymizeCustomer,
  deactivateCustomer,
  deleteCustomer,
  getCustomers,
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
export function BusinessCustomersPage() {
  const client = useQueryClient();
  const { user } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  // Live search: the list follows the settled term automatically; the Search
  // button remains as an instant-apply accessibility fallback.
  void useDebouncedValue(search, 300, (term) => setApplied(term.trim()));
  const [category, setCategory] = useState('');
  const [filters, setFilters] = useState({
    tier: '',
    seller: '',
    from: '',
    to: '',
    sort: 'created',
  });
  const customers = useQuery({
    queryKey: ['business', 'customers', applied, category, filters],
    queryFn: () =>
      getCustomers({
        search: applied || undefined,
        category: category || undefined,
        ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      }),
  });
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <FilterBar
          search={
            <SearchField
              label="Search customers"
              placeholder="Name, email, customer or membership number"
              value={search}
              onChange={setSearch}
            />
          }
          actions={
            <>
              <label>
                Customer category{' '}
                <select
                  aria-label="Customer category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {Object.entries(CUSTOMER_CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                VIP Tier
                <select
                  aria-label="VIP Tier"
                  value={filters.tier}
                  onChange={(e) => setFilters({ ...filters, tier: e.target.value })}
                >
                  <option value="">All tiers</option>
                  {['GOLD', 'SILVER', 'BRONZE'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Seller
                <select
                  aria-label="Seller"
                  value={filters.seller}
                  onChange={(e) => setFilters({ ...filters, seller: e.target.value })}
                >
                  <option value="">All sellers</option>
                  {sellers.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input
                  aria-label="From date"
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  aria-label="To date"
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                />
              </label>
              <label>
                Sort
                <select
                  aria-label="Sort customers"
                  value={filters.sort}
                  onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
                >
                  {Object.entries({
                    name: 'Customer Name',
                    tier: 'VIP Tier',
                    category: 'Category',
                    payment_status: 'Payment Status',
                    membership_status: 'Membership Status',
                    verified_paid: 'Verified Paid',
                    created: 'Created Date',
                  }).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </>
          }
        />
      </form>

      {customers.isPending ? (
        <p role="status">Loading customers…</p>
      ) : customers.isError ? (
        <ErrorState error={customers.error} onRetry={customers.refetch} />
      ) : customers.data?.length === 0 ? (
        <EmptyState
          title="No customers found."
          description="Register the first customer to get started."
        />
      ) : (
        <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer ID / Code</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Government ID</th>
                <th>Status</th>
                <th>Category</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    {customer.customerNumber}
                    {/* The customer's own Customer Code, so staff can match what
                        the member quotes at a desk. It is a second line, never
                        the primary identifier, and it is never an export column. */}
                    {customer.customerCode ? (
                      <>
                        <br />
                        <small>{customer.customerCode}</small>
                      </>
                    ) : null}
                  </td>
                  <td>{customer.fullName}</td>
                  <td>{customer.email}</td>
                  <td>{customer.phone}</td>
                  {/* Only ever the masked form; the API never returns the number. */}
                  <td>{customer.governmentIdMasked ?? '—'}</td>
                  <td>
                    <StatusChip label={customer.status} />
                  </td>
                  <td>
                    {
                      CUSTOMER_CATEGORY_LABELS[
                        customer.derivedCategory ??
                          resolveCustomerCategory({
                            customerStatus: customer.status,
                            membershipStatus: customer.hasActiveMembership ? 'active' : null,
                            verifiedTotal: '0.00',
                            priceTotal: '0.00',
                          })
                      ]
                    }
                  </td>
                  <td>
                    {canCreate && <Button
                      size="sm"
                      variant="secondary"
                      disabled={customer.status === 'cancelled'}
                      onClick={() => {
                        navigate('/admin/customers/applications/new?customerId='+encodeURIComponent(customer.id));
                      }}
                    >
                      New application
                    </Button>}{' '}
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
