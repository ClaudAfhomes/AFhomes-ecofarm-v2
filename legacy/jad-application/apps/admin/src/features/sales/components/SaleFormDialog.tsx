import { useEffect, useMemo, useState } from 'react';

import { Button, Dialog, Select } from '@jad/ui';
import type { AdminMember, Sale } from '@jad/contracts';
import { formatMoney } from '@jad/shared';

import { getMembers } from '../../members/repositories/memberRepository';
import { useProperties } from '../../catalog/hooks/useProperties';
import { useCreateSale } from '../hooks/useCreateSale';
import { useUpdateSale } from '../hooks/useUpdateSale';

interface SaleFormDialogProps {
  open: boolean;
  onClose: () => void;
  sale?: Sale | null;
}

const STATUS_OPTIONS = [
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'ADMIN_APPROVED', label: 'Admin Approved' },
  { value: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
  { value: 'QUALIFYING_SALE', label: 'Qualifying Sale' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'LOCKED', label: 'Locked' },
];

export function SaleFormDialog({ open, onClose, sale }: SaleFormDialogProps) {
  const isEdit = Boolean(sale);
  const createMut = useCreateSale();
  const updateMut = useUpdateSale();

  const [members, setMembers] = useState<AdminMember[]>([]);
  const { data: liveProperties } = useProperties();
  const properties = liveProperties ?? [];
  const [form, setForm] = useState({
    propertyId: '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    sellerId: '',
    referrerId: '',
    status: 'SUBMITTED' as Sale['status'],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      getMembers()
        .then(setMembers)
        .catch(() => setMembers([]));
    }
  }, [open]);

  const memberOptions = useMemo(
    () =>
      members.map((m) => ({
        value: m.id,
        label: `${m.firstName} ${m.lastName} (${m.id})`,
      })),
    [members],
  );

  const referrerOptions = useMemo(() => {
    if (!form.sellerId) return [];
    return members
      .filter((m) => m.sponsorId === form.sellerId)
      .map((m) => ({
        value: m.id,
        label: `${m.firstName} ${m.lastName} (${m.id})`,
      }));
  }, [members, form.sellerId]);

  const propertyOptions = useMemo(
    () =>
      properties
        .filter((p) => p.status === 'ACTIVE')
        .map((p) => ({
          value: p.id,
          label: `${p.name} - ${p.price ? formatMoney(p.price) : 'Price unavailable'}`,
        })),
    [properties],
  );

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === form.propertyId),
    [form.propertyId, properties],
  );

  const sellerName = useMemo(() => {
    const m = members.find((m) => m.id === form.sellerId);
    return m ? `${m.firstName} ${m.lastName}` : '';
  }, [members, form.sellerId]);

  useEffect(() => {
    if (sale) {
      setForm({
        propertyId: sale.propertyId,
        customerName: sale.customerName,
        customerPhone: '',
        customerEmail: '',
        sellerId: sale.sellerId,
        referrerId: (sale as unknown as { referrerId?: string }).referrerId ?? '',
        status: sale.status,
      });
    } else {
      setForm({
        propertyId: '',
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        sellerId: '',
        referrerId: '',
        status: 'SUBMITTED',
      });
    }
    setErrors({});
    setSubmitError(undefined);
  }, [sale, open]);

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.propertyId) e.propertyId = 'Select a property';
    if (!form.customerName.trim()) e.customerName = 'Customer name is required';
    if (!form.customerPhone.trim()) e.customerPhone = 'Mobile number is required';
    else if (!/^\+?[\d\s\-()]{7,20}$/.test(form.customerPhone.trim()))
      e.customerPhone = 'Enter a valid mobile number';
    if (form.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim()))
      e.customerEmail = 'Enter a valid email address';
    if (!form.sellerId) e.sellerId = 'Seller is required';
    return e;
  };

  const handleSubmit = async () => {
    if (isPending) return;
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setSubmitError(undefined);
    const referrerMember = members.find((m) => m.id === form.referrerId);
    const referrerName = referrerMember
      ? `${referrerMember.firstName} ${referrerMember.lastName}`
      : '';
    const prop = properties.find((p) => p.id === form.propertyId);
    try {
      if (isEdit && sale) {
        await updateMut.mutateAsync({
          id: sale.id,
          patch: {
            propertyId: form.propertyId,
            propertyName: prop?.name ?? sale.propertyName,
            propertyValue: prop?.price ?? sale.propertyValue,
            customerName: form.customerName.trim(),
            sellerName,
            sellerId: form.sellerId,
            status: form.status,
            referrerId: form.referrerId || null,
            referrerName: referrerName || null,
          } as unknown as Record<string, unknown>,
        });
      } else {
        await createMut.mutateAsync({
          propertyId: form.propertyId,
          propertyName: prop?.name ?? '',
          propertyValue: prop?.price ?? '',
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim(),
          customerEmail: form.customerEmail.trim() || undefined,
          sellerName,
          sellerId: form.sellerId,
          referrerName: referrerName || undefined,
          referrerId: form.referrerId || undefined,
        });
      }
      onClose();
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Sale' : 'Create Sale'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isPending}>
            {isEdit ? 'Save changes' : 'Create sale'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)', minWidth: 320 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-propertyId"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Property <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Select
            aria-label="Property"
            value={form.propertyId}
            onChange={(e) => setForm((s) => ({ ...s, propertyId: e.target.value }))}
            options={[{ value: '', label: 'Select property…' }, ...propertyOptions]}
          />
          {errors.propertyId ? (
            <span
              id="sale-propertyId-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.propertyId}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-propertyValue"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Property Value
          </label>
          <input
            id="sale-propertyValue"
            value={selectedProperty?.price ? formatMoney(selectedProperty.price) : ''}
            readOnly
            aria-label="Property value"
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
              background: 'var(--color-bg-surface)',
              color: selectedProperty?.price
                ? 'var(--color-text-primary)'
                : 'var(--color-text-muted)',
              cursor: 'not-allowed',
            }}
          />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
            Auto-filled from catalog; snapshotted at submission (BI-006)
          </span>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-customerName"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Customer <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="sale-customerName"
            value={form.customerName}
            onChange={(e) => setForm((s) => ({ ...s, customerName: e.target.value }))}
            placeholder="Ramon Reyes"
            aria-label="Customer name"
            aria-invalid={Boolean(errors.customerName)}
            aria-describedby={errors.customerName ? 'sale-customerName-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.customerName ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.customerName ? (
            <span
              id="sale-customerName-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.customerName}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-customerPhone"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Mobile Number <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            id="sale-customerPhone"
            value={form.customerPhone}
            onChange={(e) => setForm((s) => ({ ...s, customerPhone: e.target.value }))}
            placeholder="+63 917 123 4567"
            aria-label="Customer mobile number"
            aria-invalid={Boolean(errors.customerPhone)}
            aria-describedby={errors.customerPhone ? 'sale-customerPhone-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.customerPhone ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.customerPhone ? (
            <span
              id="sale-customerPhone-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.customerPhone}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-customerEmail"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Email
          </label>
          <input
            id="sale-customerEmail"
            type="email"
            value={form.customerEmail}
            onChange={(e) => setForm((s) => ({ ...s, customerEmail: e.target.value }))}
            placeholder="ramon.reyes@example.com"
            aria-label="Customer email"
            aria-invalid={Boolean(errors.customerEmail)}
            aria-describedby={errors.customerEmail ? 'sale-customerEmail-error' : undefined}
            style={{
              minHeight: 44,
              padding: '10px 12px',
              border: `1px solid ${errors.customerEmail ? 'var(--color-danger)' : 'var(--color-border-default)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-body-s)',
            }}
          />
          {errors.customerEmail ? (
            <span
              id="sale-customerEmail-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.customerEmail}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-sellerId"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Seller Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Select
            aria-label="Seller"
            value={form.sellerId}
            onChange={(e) => {
              const nextSeller = e.target.value;
              setForm((s) => {
                const nextRefValid = members.some(
                  (m) => m.id === s.referrerId && m.sponsorId === nextSeller,
                );
                return { ...s, sellerId: nextSeller, referrerId: nextRefValid ? s.referrerId : '' };
              });
            }}
            options={[{ value: '', label: 'Select seller…' }, ...memberOptions]}
          />
          {errors.sellerId ? (
            <span
              id="sale-sellerId-error"
              style={{ color: 'var(--color-danger)', fontSize: 'var(--text-caption)' }}
              role="alert"
            >
              {errors.sellerId}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label
            htmlFor="sale-referrerId"
            style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
          >
            Referrer
          </label>
          <Select
            aria-label="Referrer"
            value={form.referrerId}
            onChange={(e) => setForm((s) => ({ ...s, referrerId: e.target.value }))}
            options={[{ value: '', label: 'No referrer' }, ...referrerOptions]}
          />
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' }}>
            The member who referred this customer. Empty awards the seller&apos;s sponsor.
          </span>
        </div>

        {isEdit ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <label
              htmlFor="sale-status"
              style={{ fontSize: 'var(--text-body-s)', fontWeight: 600 }}
            >
              Status
            </label>
            <Select
              aria-label="Sale status"
              value={form.status}
              onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as Sale['status'] }))}
              options={STATUS_OPTIONS}
            />
          </div>
        ) : null}

        {submitError ? (
          <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-body-s)' }} role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
