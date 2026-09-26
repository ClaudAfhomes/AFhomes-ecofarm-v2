import { useEffect, useState } from 'react';

import { Button, Dialog } from '@jad/ui';
import { CMS_PROPERTIES_SEED, type CatalogPropertyStatus } from '@jad/contracts';

import { useCreateProperty } from '../hooks/useCreateProperty';
import { useUpdateProperty } from '../hooks/useUpdateProperty';
import type { CatalogProperty } from '@jad/contracts';

type Props = {
  open: boolean;
  onClose: () => void;
  property?: CatalogProperty;
};

export function PropertyFormDialog({ open, onClose, property }: Props) {
  const isEdit = Boolean(property);
  const createMutation = useCreateProperty();
  const updateMutation = useUpdateProperty();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<CatalogPropertyStatus>('ACTIVE');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (property) {
      setName(property.name);
      setCategoryId(property.categoryId);
      setPrice(property.price ?? '');
      setStatus(property.status);
    } else {
      setName('');
      setCategoryId('');
      setPrice('');
      setStatus('ACTIVE');
    }
    setErrors({});
  }, [open, property]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required.';
    if (!categoryId) e.categoryId = 'Category is required.';
    if (price.trim() && !/^\d+(\.\d{1,2})?$/.test(price.trim())) {
      e.price = 'Enter a valid amount (e.g. 1200000.00).';
    }
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      if (isEdit && property) {
        await updateMutation.mutateAsync({
          id: property.id,
          input: {
            name: name.trim(),
            categoryId,
            price: price.trim() || null,
            status,
          },
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          categoryId,
          price: price.trim() || undefined,
          status,
        });
      }
      onClose();
    } catch {
      setErrors({ submit: 'Something went wrong. Please try again.' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Property' : 'Create Property'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Property'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 340 }}>
        {errors.submit ? (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '10px 12px',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              color: 'var(--color-danger)',
            }}
          >
            {errors.submit}
          </p>
        ) : null}

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 250 SQM Farm Lot"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'property-name-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.name ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.name ? (
            <span
              id="property-name-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.name}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Category <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-invalid={Boolean(errors.categoryId)}
            aria-describedby={errors.categoryId ? 'property-category-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.categoryId ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              backgroundColor: 'var(--color-bg-surface)',
            }}
          >
            <option value="">Select a category</option>
            {CMS_PROPERTIES_SEED.categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.title}
              </option>
            ))}
          </select>
          {errors.categoryId ? (
            <span
              id="property-category-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.categoryId}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>Price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 1200000.00"
            aria-invalid={Boolean(errors.price)}
            aria-describedby={errors.price ? 'property-price-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.price ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.price ? (
            <span
              id="property-price-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.price}
            </span>
          ) : null}
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
            Exact decimal format. Leave empty if not applicable.
          </span>
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CatalogPropertyStatus)}
            style={{
              padding: '10px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              backgroundColor: 'var(--color-bg-surface)',
            }}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}
