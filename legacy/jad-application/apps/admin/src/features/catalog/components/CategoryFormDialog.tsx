import { useEffect, useState } from 'react';

import { Button, Dialog } from '@jad/ui';

import { useCreateCategory } from '../hooks/useCreateCategory';
import { useUpdateCategory } from '../hooks/useUpdateCategory';
import type { PropertyCategory } from '../services/catalog';

type Props = {
  open: boolean;
  onClose: () => void;
  category?: PropertyCategory;
};

export function CategoryFormDialog({ open, onClose, category }: Props) {
  const isEdit = Boolean(category);
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (category) {
      setSlug(category.slug);
      setTitle(category.title);
      setShortDescription(category.shortDescription);
      setDescription(category.description);
      setIsFeatured(category.isFeatured ?? false);
    } else {
      setSlug('');
      setTitle('');
      setShortDescription('');
      setDescription('');
      setIsFeatured(false);
    }
    setErrors({});
  }, [open, category]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!isEdit) {
      if (!slug.trim()) e.slug = 'Slug is required.';
      else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
        e.slug = 'Slug must be lowercase alphanumeric with hyphens.';
      }
    }
    if (!title.trim()) e.title = 'Title is required.';
    if (!shortDescription.trim()) e.shortDescription = 'Short description is required.';
    if (!description.trim()) e.description = 'Description is required.';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    try {
      if (isEdit && category) {
        await updateMutation.mutateAsync({
          slug: category.slug,
          input: {
            title: title.trim(),
            shortDescription: shortDescription.trim(),
            description: description.trim(),
            isFeatured,
          },
        });
      } else {
        await createMutation.mutateAsync({
          slug: slug.trim(),
          title: title.trim(),
          shortDescription: shortDescription.trim(),
          description: description.trim(),
          image: { id: 'photo-placeholder', alt: title.trim() },
          isFeatured,
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
      title={isEdit ? 'Edit Category' : 'Create Category'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Category'}
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

        {!isEdit ? (
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
              Slug <span style={{ color: 'var(--color-danger)' }}>*</span>
            </span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. new-category"
              aria-invalid={Boolean(errors.slug)}
              aria-describedby={errors.slug ? 'category-slug-error' : undefined}
              style={{
                padding: '10px 12px',
                border: `1px solid ${errors.slug ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-s)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            {errors.slug ? (
              <span
                id="category-slug-error"
                style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
                role="alert"
              >
                {errors.slug}
              </span>
            ) : null}
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Lowercase alphanumeric with hyphens. Cannot be changed after creation.
            </span>
          </label>
        ) : (
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>Slug</span>
            <input
              value={slug}
              disabled
              style={{
                padding: '10px 12px',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body-s)',
                fontFamily: 'var(--font-mono)',
                opacity: 0.6,
                cursor: 'not-allowed',
              }}
            />
          </label>
        )}

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Title <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New Category"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'category-title-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.title ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.title ? (
            <span
              id="category-title-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.title}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Short Description <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <input
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            placeholder="Brief description for the category"
            aria-invalid={Boolean(errors.shortDescription)}
            aria-describedby={errors.shortDescription ? 'category-short-desc-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.shortDescription ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.shortDescription ? (
            <span
              id="category-short-desc-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.shortDescription}
            </span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>
            Description <span style={{ color: 'var(--color-danger)' }}>*</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Full description for the category"
            rows={3}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'category-desc-error' : undefined}
            style={{
              padding: '10px 12px',
              border: `1px solid ${errors.description ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              resize: 'vertical',
            }}
          />
          {errors.description ? (
            <span
              id="category-desc-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.description}
            </span>
          ) : null}
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isFeatured}
            onChange={(e) => setIsFeatured(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}>Featured category</span>
        </label>
      </div>
    </Dialog>
  );
}
