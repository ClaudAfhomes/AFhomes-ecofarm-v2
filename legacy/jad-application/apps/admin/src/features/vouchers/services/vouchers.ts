import {
  voucherAssignmentSchema,
  voucherTemplateSchema,
  type UpdateVoucherTemplateRequest,
  type VoucherAssignment,
  type VoucherTemplate,
  type AssignVoucherRequest,
} from '@jad/contracts';
import { z } from 'zod';

import { request, requestList } from '../../../lib/api/client';

const deleteResultSchema = z.object({ id: z.string(), deleted: z.boolean() });

export type CreateVoucherInput = { title: string; originalValue: string };

export type AssignVoucherInput = AssignVoucherRequest;

/**
 * Voucher service - "Create Voucher" makes a definition (title + value); a
 * member is assigned to it afterwards with per-assignment expiry/validity.
 * The backend is the system of record; failures surface to the caller.
 */

/** Voucher definitions (the "Create Voucher" list). */
export function getVoucherTemplates(): Promise<VoucherTemplate[]> {
  return requestList('/admin/voucher-templates', voucherTemplateSchema);
}

/** A single voucher definition. */
export function getVoucherTemplate(id: string): Promise<VoucherTemplate> {
  return request(`/admin/voucher-templates/${id}`, voucherTemplateSchema);
}

/** PATCH /admin/voucher-templates/:id - edit a voucher definition (title/expiry/validity). */
export function updateVoucherTemplate(
  id: string,
  patch: UpdateVoucherTemplateRequest,
): Promise<VoucherTemplate> {
  return request(`/admin/voucher-templates/${id}`, voucherTemplateSchema, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** DELETE /admin/voucher-templates/:id - delete a definition and its assignments. */
export async function deleteVoucherTemplate(id: string): Promise<boolean> {
  await request(`/admin/voucher-templates/${id}`, deleteResultSchema, { method: 'DELETE' });
  return true;
}

/** POST /admin/voucher-templates - create a voucher definition (title + value). */
export function createVoucher(input: CreateVoucherInput): Promise<VoucherTemplate> {
  return request('/admin/voucher-templates', voucherTemplateSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Assignments for one voucher definition (member-scoped vouchers). */
export function getVoucherAssignments(templateId: string): Promise<VoucherAssignment[]> {
  return requestList(
    `/admin/vouchers?templateId=${encodeURIComponent(templateId)}`,
    voucherAssignmentSchema,
  );
}

/** All member-scoped vouchers across definitions (backs list-page counts). */
export function getAllVoucherAssignments(): Promise<VoucherAssignment[]> {
  return requestList('/admin/vouchers', voucherAssignmentSchema);
}

/** POST /admin/vouchers/assign - assign a definition to a member with expiry/validity. */
export function assignVoucher(input: AssignVoucherInput): Promise<VoucherAssignment> {
  const body: Record<string, unknown> = { templateId: input.templateId, memberId: input.memberId };
  if (input.expiresAt !== undefined) body.expiresAt = input.expiresAt;
  if (input.validityDays !== undefined) body.validityDays = input.validityDays;
  return request('/admin/vouchers/assign', voucherAssignmentSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** POST /admin/vouchers/scan - resolve a QR code (verify-only). */
export function scanVoucher(code: string): Promise<VoucherAssignment> {
  return request('/admin/vouchers/scan', voucherAssignmentSchema, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/** POST /admin/vouchers/:id/redeem - confirm a scan, redeem in full. */
export function redeemVoucher(id: string): Promise<VoucherAssignment> {
  return request(`/admin/vouchers/${id}/redeem`, voucherAssignmentSchema, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** DELETE /admin/vouchers/:id - revoke/unassign one member voucher. */
export async function deleteVoucher(id: string): Promise<boolean> {
  await request(`/admin/vouchers/${id}`, deleteResultSchema, { method: 'DELETE' });
  return true;
}
