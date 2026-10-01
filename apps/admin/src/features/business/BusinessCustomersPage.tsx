import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  StatusChip,
} from '@jad/ui';
import type { CreateCustomerRequest, Customer, CustomerOnboardingRecovery } from '@jad/contracts';

import { useSession } from '../../lib/session';
import {
  anonymizeCustomer,
  createCustomer,
  deactivateCustomer,
  deleteCustomer,
  getCardProducts,
  getCustomers,
  issueCustomerAccountActivation,
  getOfficialFormTemplate,
  previewOfficialFormImport,
} from './services';
import { SaleApplicationDialog } from './SaleApplicationDialog';

const EMPTY: CreateCustomerRequest = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  address: { line1: '', city: '', province: '', countryCode: 'PH' },
};

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
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const customers = useQuery({
    queryKey: ['business', 'customers', applied],
    queryFn: () => getCustomers(applied ? { search: applied } : {}),
  });
  const products = useQuery({
    queryKey: ['business', 'card-products'],
    queryFn: () => getCardProducts(),
  });
  // New applications may only offer ACTIVE plans under ACTIVE categories.
  // The list endpoint already returns sellable-only by default, but the
  // filter below keeps the dialog correct even when the shared cache holds
  // a management (all/inactive) view.
  const activeProducts = (products.data ?? []).filter(
    (product) => product.isActive && product.categoryIsActive,
  );
  const canIssueActivation =
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'sales.customers' && permission.canUpdate,
    ) === true;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerRequest>(EMPTY);
  const [selling, setSelling] = useState<string | null>(null);
  const [accountAction, setAccountAction] = useState<{
    kind: 'deactivate' | 'delete' | 'anonymize';
    customer: Customer;
  } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [activationResult, setActivationResult] = useState<CustomerOnboardingRecovery | null>(null);
  const [activationCustomerId, setActivationCustomerId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [importErrors, setImportErrors] = useState<{ field: string; message: string }[]>([]);

  const downloadFile = (file: { filename: string; mime: string; content: string }) => {
    const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importXlsx = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const preview = await previewOfficialFormImport('customer_application', btoa(binary));
    const f = preview.fields;
    setForm({
      ...EMPTY,
      firstName: f.primary_first_name ?? '',
      middleName: f.primary_middle_name || undefined,
      lastName: f.primary_last_name ?? '',
      suffix: f.primary_suffix || undefined,
      dateOfBirth: f.primary_birth_date ?? '',
      gender:
        f.primary_sex?.toLowerCase() === 'male' || f.primary_sex?.toLowerCase() === 'female'
          ? (f.primary_sex.toLowerCase() as 'male' | 'female')
          : undefined,
      email: f.primary_email ?? '',
      phone: f.primary_mobile ?? '',
      address: {
        line1: f.primary_address_line_1 ?? '',
        line2: f.primary_address_line_2 || undefined,
        city: f.primary_city_municipality ?? '',
        province: f.primary_province ?? '',
        postalCode: f.primary_postal_code || undefined,
        countryCode: 'PH',
      },
    });
    setImportErrors(preview.errors);
    setImportMessage('Imported fields are candidates only — review and correct every value before registering.');
    setOpen(true);
  };

  const set = <K extends keyof CreateCustomerRequest>(key: K, value: CreateCustomerRequest[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const create = useMutation({
    mutationFn: () => createCustomer(form),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['business', 'customers'] });
      setForm(EMPTY);
      setOpen(false);
    },
  });
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
        description="Register a customer and open a card application. Financial terms are set by the product, not by the seller."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={async () => downloadFile(await getOfficialFormTemplate('customer'))}
            >
              Download import template
            </Button>
            <label>
              <span className="sr-only">Import customer XLSX</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importXlsx(file);
                  event.target.value = '';
                }}
              />
            </label>
            <Button onClick={() => { setImportMessage(''); setImportErrors([]); setOpen(true); }}>
              Register customer
            </Button>
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
              placeholder="Name, email or customer number"
              value={search}
              onChange={setSearch}
            />
          }
          actions={
            <Button type="submit" variant="secondary">
              Search
            </Button>
          }
        />
      </form>

      {customers.isPending ? (
        <p role="status">Loading customers…</p>
      ) : customers.isError ? (
        <ErrorState error={customers.error} onRetry={customers.refetch} />
      ) : customers.data?.length === 0 ? (
        <EmptyState
          title="No customers"
          description="Register the first customer to get started."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Government ID</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.customerNumber}</td>
                  <td>{customer.fullName}</td>
                  <td>{customer.email}</td>
                  <td>{customer.phone}</td>
                  {/* Only ever the masked form; the API never returns the number. */}
                  <td>{customer.governmentIdMasked ?? '—'}</td>
                  <td>
                    <StatusChip
                      label={customer.status}
                      tone={customer.status === 'active' ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={customer.status === 'cancelled'}
                      onClick={() => {
                        setSelling(customer.id);
                      }}
                    >
                      New application
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      disabled={customer.status === 'suspended' || customer.status === 'cancelled'}
                      onClick={() => setAccountAction({ kind: 'deactivate', customer })}
                    >
                      Deactivate Account
                    </Button>
                    {canIssueActivation &&
                    customer.hasActiveMembership &&
                    !customer.portalAccountActivated ? (
                      <>
                        {' '}
                        <Button
                          variant="secondary"
                          disabled={
                            issueActivation.isPending && activationCustomerId === customer.id
                          }
                          onClick={() => issueActivation.mutate(customer.id)}
                        >
                          {issueActivation.isPending && activationCustomerId === customer.id
                            ? 'Issuing activation link…'
                            : 'Issue / Reissue activation link'}
                        </Button>
                      </>
                    ) : null}
                    {user?.roleSlug === 'super_admin' ? (
                      <>
                        {' '}
                        <Button
                          variant="secondary"
                          onClick={() => setAccountAction({ kind: 'anonymize', customer })}
                        >
                          Anonymize
                        </Button>{' '}
                        <Button
                          variant="danger"
                          onClick={() => setAccountAction({ kind: 'delete', customer })}
                        >
                          Delete Permanently
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Register customer"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={create.isPending || !form.firstName || !form.lastName || !form.dateOfBirth}
              onClick={() => create.mutate()}
            >
              Register
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          {importMessage ? <p role="status">{importMessage}</p> : null}
          {importErrors.length ? (
            <div role="alert">
              <strong>Import needs correction:</strong>
              <ul>{importErrors.map((error) => <li key={`${error.field}:${error.message}`}>{error.field}: {error.message}</li>)}</ul>
            </div>
          ) : null}
          <label>
            First name
            <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </label>
          <label>
            Middle name
            <input
              value={form.middleName ?? ''}
              onChange={(e) => set('middleName', e.target.value)}
            />
          </label>
          <label>
            Last name
            <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </label>
          <label>
            Date of birth (YYYY-MM-DD)
            <input
              value={form.dateOfBirth}
              onChange={(e) => set('dateOfBirth', e.target.value)}
              placeholder="1990-05-04"
            />
          </label>
          <label>
            Email
            <input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label>
            Address line
            <input
              value={form.address.line1}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  address: { ...prev.address, line1: e.target.value },
                }))
              }
            />
          </label>
          <label>
            City
            <input
              value={form.address.city}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, address: { ...prev.address, city: e.target.value } }))
              }
            />
          </label>
          <label>
            Province
            <input
              value={form.address.province}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  address: { ...prev.address, province: e.target.value },
                }))
              }
            />
          </label>
          <label>
            Government ID type
            <select
              value={form.governmentIdType ?? ''}
              onChange={(e) =>
                set(
                  'governmentIdType',
                  e.target.value
                    ? (e.target.value as NonNullable<CreateCustomerRequest['governmentIdType']>)
                    : undefined,
                )
              }
            >
              <option value="">Not provided</option>
              <option value="philippine_id">PhilSys ID</option>
              <option value="drivers_license">Driver&apos;s licence</option>
              <option value="passport">Passport</option>
              <option value="tax_id">Tax ID</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Government ID number (stored privately, never displayed in full)
            <input
              value={form.governmentIdNumber ?? ''}
              onChange={(e) => set('governmentIdNumber', e.target.value)}
            />
          </label>
          {create.error ? <p role="alert">{create.error.message}</p> : null}
        </div>
      </Dialog>

      {selling !== null ? (
        <SaleApplicationDialog
          customerId={selling}
          products={activeProducts}
          productsPending={products.isPending}
          productsError={products.error}
          onClose={() => setSelling(null)}
          onCreated={() => setSelling(null)}
        />
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
            ? 'Delete Permanently'
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
