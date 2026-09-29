import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  StatusChip,
} from '@jad/ui';
import type { CreateCustomerRequest } from '@jad/contracts';

import { createCustomer, getCardProducts, getCustomers } from './services';
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
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const customers = useQuery({
    queryKey: ['business', 'customers', applied],
    queryFn: () => getCustomers(applied ? { search: applied } : {}),
  });
  const products = useQuery({ queryKey: ['business', 'card-products'], queryFn: () => getCardProducts() });
  // New applications may only offer ACTIVE plans under ACTIVE categories.
  // The list endpoint already returns sellable-only by default, but the
  // filter below keeps the dialog correct even when the shared cache holds
  // a management (all/inactive) view.
  const activeProducts = (products.data ?? []).filter(
    (product) => product.isActive && product.categoryIsActive,
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerRequest>(EMPTY);
  const [selling, setSelling] = useState<string | null>(null);

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

  return (
    <section>
      <PageHeader
        title="Customers"
        description="Register a customer and open a card application. Financial terms are set by the product, not by the seller."
        actions={
          <Button onClick={() => setOpen(true)}>Register customer</Button>
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
        <EmptyState title="No customers" description="Register the first customer to get started." />
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
                    </Button>
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
          <label>
            First name
            <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </label>
          <label>
            Middle name
            <input value={form.middleName ?? ''} onChange={(e) => set('middleName', e.target.value)} />
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
                setForm((prev) => ({ ...prev, address: { ...prev.address, province: e.target.value } }))
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
    </section>
  );
}
