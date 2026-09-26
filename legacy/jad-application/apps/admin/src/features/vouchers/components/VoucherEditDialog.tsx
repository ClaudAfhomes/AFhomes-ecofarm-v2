import { useState } from 'react';

import { Button, Dialog } from '@jad/ui';
import type { UpdateVoucherTemplateRequest, VoucherTemplate } from '@jad/contracts';

import { useUpdateVoucherTemplate } from '../hooks/useUpdateVoucherTemplate';

interface VoucherEditDialogProps {
  open: boolean;
  template: VoucherTemplate | null;
  onClose: () => void;
}

const WHOLE_DAYS_RE = /^\d+$/;

/** `YYYY-MM-DD` for a `date` input from an ISO timestamp (undefined when unset). */
function toDateInput(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/**
 * Edit a voucher definition (title + expiry/validity). The original value is
 * intentionally read-only: assigned member vouchers snapshot it at issue, so
 * changing it would split history (mirrors PATCH /admin/voucher-templates/:id,
 * which rejects `originalValue`).
 *
 * The parent keys this dialog by template id, so state initializes fresh per
 * template and resets on every open (no prefill effect needed).
 */
export function VoucherEditDialog({ open, template, onClose }: VoucherEditDialogProps) {
  const updateMutation = useUpdateVoucherTemplate(template?.id ?? '');
  const [title, setTitle] = useState(template?.title ?? '');
  const [expiresOn, setExpiresOn] = useState(toDateInput(template?.expiresAt));
  const [validityDays, setValidityDays] = useState(
    template?.validityDays !== undefined ? String(template.validityDays) : '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | undefined>();

  if (!template) return null;
  const current: VoucherTemplate = template;

  const titleValue = title.trim();
  const expiresValue = expiresOn.trim();
  const daysValue = validityDays.trim();

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!titleValue) e.title = 'Enter a voucher title.';
    if (daysValue && (!WHOLE_DAYS_RE.test(daysValue) || Number(daysValue) < 1))
      e.validityDays = 'Enter a whole number of days.';
    return e;
  };

  const titleChanged = titleValue !== current.title;
  const expiryChanged = expiresValue !== toDateInput(current.expiresAt);
  const daysChanged = daysValue !== (current.validityDays !== undefined ? String(current.validityDays) : '');
  const dirty = titleChanged || expiryChanged || daysChanged;
  const canSave = dirty && titleValue.length > 0 && !updateMutation.isPending;

  const handleSubmit = async () => {
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    if (!dirty) {
      onClose();
      return;
    }
    setSubmitError(undefined);
    const patch: UpdateVoucherTemplateRequest = {};
    if (titleChanged) patch.title = titleValue;
    if (expiryChanged) {
      patch.expiresAt = expiresValue ? new Date(`${expiresValue}T00:00:00`).toISOString() : null;
    }
    if (daysChanged) {
      patch.validityDays = daysValue ? Number(daysValue) : null;
    }
    try {
      await updateMutation.mutateAsync(patch);
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={updateMutation.isPending ? () => {} : onClose}
      title={`Edit ${current.title}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={updateMutation.isPending}
            disabled={!canSave}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', minWidth: 'min(320px, 100%)' }}>
        {submitError ? (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-body-s)' }}>
            {submitError}
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="voucher-edit-title"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Title <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="voucher-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Welcome Gift"
            aria-label="Title"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? 'voucher-edit-title-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.title ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.title ? (
            <span
              id="voucher-edit-title-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.title}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="voucher-edit-expires"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Expiry Date
          </label>
          <input
            id="voucher-edit-expires"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            aria-label="Expiry Date"
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="voucher-edit-validity"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Valid for (days)
          </label>
          <input
            id="voucher-edit-validity"
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
            placeholder="90"
            inputMode="numeric"
            aria-label="Valid for days"
            aria-invalid={Boolean(errors.validityDays)}
            aria-describedby={errors.validityDays ? 'voucher-edit-validity-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.validityDays ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.validityDays ? (
            <span
              id="voucher-edit-validity-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.validityDays}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
              Clear both fields for an open-ended voucher. The value is fixed once created.
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
