import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, EmptyState, ErrorState, PageHeader, StatusChip } from '@jad/ui';

import { formatMoney, formatPoints, formatRate } from './format';
import { getCardProducts, updateCardProduct } from './services';

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Card products. Prices are database-backed: this screen reads and writes
 * `/card-products` and never hardcodes Bronze/Silver/Gold economics.
 *
 * Editing a product does NOT rewrite history. Every sale stores its own
 * commercial snapshot, so a price change here only affects future sales.
 */
export function BusinessProductsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['business', 'card-products'], queryFn: getCardProducts });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [price, setPrice] = useState('');
  const [down, setDown] = useState('');
  const [points, setPoints] = useState('');
  const [rate, setRate] = useState('');

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'card-products'] });
  };

  const save = useMutation({
    mutationFn: () =>
      updateCardProduct(editing!.id, {
        cashPrice: price,
        minimumDownPayment: down,
        yearlyPoints: Number(points),
        commissionRate: rate,
      }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
    },
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      updateCardProduct(input.id, { isActive: input.isActive }),
    onSuccess: invalidate,
  });

  const invalid =
    !MONEY_RE.test(price) || !MONEY_RE.test(down) || !Number.isInteger(Number(points));

  return (
    <section>
      <PageHeader
        title="Card Products"
        description="Catalogue economics. Existing sales keep the terms snapshotted when they were created."
      />

      {query.isPending ? (
        <p role="status">Loading products…</p>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data?.length === 0 ? (
        <EmptyState title="No card products" description="Seed the catalogue to start selling." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Cash price</th>
                <th>Min. down payment</th>
                <th>Yearly points</th>
                <th>Commission</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((product) => (
                <tr key={product.id}>
                  <td>{product.code}</td>
                  <td>{product.name}</td>
                  <td>{formatMoney(product.cashPrice)}</td>
                  <td>{formatMoney(product.minimumDownPayment)}</td>
                  <td>{formatPoints(product.yearlyPoints)}</td>
                  <td>{formatRate(product.commissionRate)}</td>
                  <td>
                    <StatusChip
                      label={product.isActive ? 'Active' : 'Inactive'}
                      tone={product.isActive ? 'success' : 'neutral'}
                    />
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing({ id: product.id, name: product.name });
                        setPrice(product.cashPrice);
                        setDown(product.minimumDownPayment);
                        setPoints(String(product.yearlyPoints));
                        setRate(product.commissionRate);
                      }}
                    >
                      Edit
                    </Button>{' '}
                    <Button
                      variant="secondary"
                      onClick={() =>
                        toggle.mutate({ id: product.id, isActive: !product.isActive })
                      }
                    >
                      {product.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toggle.isError ? <p role="alert">{toggle.error.message}</p> : null}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p>
            Changing these values affects only <strong>future</strong> sales. Sales already created keep
            the price, minimum down payment, points and commission they were created with.
          </p>
          <label>
            Cash price
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Minimum down payment
            <input value={down} onChange={(e) => setDown(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Yearly points
            <input
              value={points}
              onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
            />
          </label>
          <label>
            Commission rate (0.0400 = 4%)
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </label>
          {save.error ? <p role="alert">{save.error.message}</p> : null}
        </div>
      </Dialog>
    </section>
  );
}
