import { useEffect, useMemo, useState } from 'react';

import { Button, Dialog, Select } from '@jad/ui';

import { useMembers } from '../../members/hooks/useMembers';
import { useVoucherAssignments } from '../hooks/useVoucherAssignments';
import { useAssignVoucher } from '../hooks/useAssignVoucher';

interface VoucherAssignFormDialogProps {
  open: boolean;
  onClose: () => void;
  templateId: string;
}

export function VoucherAssignFormDialog({
  open,
  onClose,
  templateId,
}: VoucherAssignFormDialogProps) {
  const { data: members } = useMembers();
  const { data: assigned } = useVoucherAssignments(templateId);
  const assignMutation = useAssignVoucher(templateId);
  const [memberId, setMemberId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | undefined>();

  // Only ACTIVE members not already holding this voucher (the API enforces the
  // same rule via the (memberId, templateId) unique index - this is UX only).
  const eligibleMembers = useMemo(() => {
    const assignedIds = new Set((assigned ?? []).map((a) => a.memberId));
    return (members ?? []).filter((m) => m.accountStatus === 'ACTIVE' && !assignedIds.has(m.id));
  }, [members, assigned]);

  useEffect(() => {
    if (open) {
      setMemberId('');
      setExpiresAt('');
      setValidityDays('');
      setErrors({});
      setSubmitError(undefined);
    }
  }, [open]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!memberId) e.memberId = 'Select a member.';
    if (validityDays && (!/^\d+$/.test(validityDays) || Number(validityDays) < 1))
      e.validityDays = 'Enter a whole number of days.';
    return e;
  };

  const handleSubmit = async () => {
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setSubmitError(undefined);
    try {
      await assignMutation.mutateAsync({
        templateId,
        memberId,
        expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00`).toISOString() : undefined,
        validityDays: validityDays ? Number(validityDays) : undefined,
      });
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign to Member"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={assignMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={assignMutation.isPending}
            disabled={eligibleMembers.length === 0}
          >
            Assign voucher
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
        {eligibleMembers.length === 0 ? (
          <p style={{ fontSize: 'var(--text-body-s)', color: 'var(--color-text-muted)' }}>
            All active members already hold this voucher.
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="assign-member"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Member <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Select
            id="assign-member"
            aria-label="Member"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            options={[
              { value: '', label: 'Select a member…' },
              ...eligibleMembers.map((m) => ({
                value: m.id,
                label: `${m.firstName} ${m.lastName}${m.email ? ` · ${m.email}` : ''}`,
              })),
            ]}
          />
          {errors.memberId ? (
            <span
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.memberId}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="assign-expires"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Expiry Date
          </label>
          <input
            id="assign-expires"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
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
            htmlFor="assign-validity"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Valid for (days)
          </label>
          <input
            id="assign-validity"
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
            placeholder="90"
            inputMode="numeric"
            aria-label="Valid for days"
            aria-invalid={Boolean(errors.validityDays)}
            aria-describedby={errors.validityDays ? 'assign-validity-error' : undefined}
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
              id="assign-validity-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.validityDays}
            </span>
          ) : null}
        </div>

        <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)', margin: 0 }}>
          A unique voucher code and QR code will be generated for this member.
        </p>
      </div>
    </Dialog>
  );
}
