import { z } from 'zod';
import { isoOrNull } from './handler-kit.js';
export const toCommission = (row: Record<string, unknown>) => {
  const staff = (row.beneficiary_staff ?? {}) as Record<string, unknown>;
  const ost = (row.beneficiary_ost ?? {}) as Record<string, unknown>;
  const sale = (row.card_sales ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    commissionNumber: (row.commission_number as string | null | undefined) ?? null,
    saleId: row.sale_id,
    saleNumber: String(sale.sale_number ?? ''),
    beneficiaryType: row.beneficiary_type,
    beneficiaryName: String(staff.full_name ?? ost.full_name ?? 'Unknown'),
    rate: row.rate_snapshot ?? '0.0400',
    basisAmount: row.basis_amount_snapshot ?? '0.00',
    amount: row.amount,
    status: row.status,
    qualificationNotes: isoOrNull(row.qualification_notes),
    qualifiedAt: isoOrNull(row.qualified_at),
    earnedAt: isoOrNull(row.earned_at),
    paidAt: isoOrNull(row.paid_at),
    createdAt: isoOrNull(row.created_at) ?? '',
  };
};

export const commissionListQuerySchema = z.object({
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  seller: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const toRule = (row: Record<string, unknown>) => ({
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  targetName: null,
  rate: row.rate,
  effectiveFrom: row.effective_from,
  effectiveUntil: row.effective_until ?? null,
  accreditedOnOrAfter: row.accredited_on_or_after ?? null,
  isActive: row.is_active === true,
  createdAt: isoOrNull(row.created_at) ?? '',
  updatedAt: isoOrNull(row.updated_at) ?? '',
});
