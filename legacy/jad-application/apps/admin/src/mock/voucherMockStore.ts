import type { VoucherAssignment, VoucherTemplate } from '@jad/contracts';
import { computeMemberExpiry } from '@jad/shared';

import { MOCK_VOUCHER_ASSIGNMENTS, MOCK_VOUCHERS } from './data';
import { configStore } from './configMockStore';
import { registrationStore } from './registrationMockStore';

/**
 * Canonical in-memory mock store for the voucher flow: "Create Voucher" makes
 * a definition (title + value); "Assign to Member" creates a unique member
 * voucher with its own expiry/validity. Mirrors the API contract - duplicates
 * rejected, code generation, verify-only scan, full redemption.
 */

let seq = 110;

export const voucherStore: {
  definitions: VoucherTemplate[];
  vouchers: VoucherAssignment[];
} = {
  definitions: MOCK_VOUCHERS.map((v) => ({ ...v })),
  vouchers: MOCK_VOUCHER_ASSIGNMENTS.map((v) => ({ ...v })),
};

function nextCode(): string {
  seq += 1;
  return `JAD-VCH-2026-${seq}`;
}

function memberNameFor(memberId: string): string | undefined {
  const member = registrationStore.members.find((m) => m.id === memberId);
  if (!member) return undefined;
  return `${member.firstName} ${member.lastName}`.trim() || memberId;
}

export function createMockVoucher(input: {
  title: string;
  originalValue: string;
}): VoucherTemplate {
  const definition: VoucherTemplate = {
    id: `vtpl-${seq}`,
    title: input.title,
    originalValue: input.originalValue,
    createdAt: new Date().toISOString(),
  };
  voucherStore.definitions.push(definition);
  return definition;
}

export function mockVoucherTemplateById(id: string): VoucherTemplate | undefined {
  return voucherStore.definitions.find((d) => d.id === id);
}

/**
 * Edit a voucher definition (title/expiry/validity). The original value is
 * not editable - assignments snapshot it at issue (mirrors the API).
 */
export function updateMockVoucherTemplate(
  id: string,
  patch: { title?: string; expiresAt?: string | null; validityDays?: number | null },
): VoucherTemplate {
  const definition = mockVoucherTemplateById(id);
  if (!definition) throw new Error('Voucher not found.');
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new Error('Enter a voucher title.');
    definition.title = patch.title.trim();
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt === null) delete definition.expiresAt;
    else definition.expiresAt = patch.expiresAt;
  }
  if (patch.validityDays !== undefined) {
    if (patch.validityDays === null) delete definition.validityDays;
    else {
      if (!Number.isInteger(patch.validityDays) || patch.validityDays < 1)
        throw new Error('Enter a whole number of days.');
      definition.validityDays = patch.validityDays;
    }
  }
  return definition;
}

/** Delete a voucher definition and revoke all its assigned member vouchers. */
export function deleteMockVoucherTemplate(id: string): void {
  const index = voucherStore.definitions.findIndex((d) => d.id === id);
  if (index < 0) throw new Error('Voucher not found.');
  voucherStore.definitions.splice(index, 1);
  voucherStore.vouchers = voucherStore.vouchers.filter((v) => v.templateId !== id);
}

/** Restore the seeded voucher store (module singleton - tests reset in beforeEach). */
export function resetVoucherStore(): void {
  voucherStore.definitions = MOCK_VOUCHERS.map((v) => ({ ...v }));
  voucherStore.vouchers = MOCK_VOUCHER_ASSIGNMENTS.map((v) => ({ ...v }));
  seq = 110;
}

export function assignMockVoucher(input: {
  templateId: string;
  memberId: string;
  expiresAt?: string;
  validityDays?: number;
}): VoucherAssignment {
  const definition = mockVoucherTemplateById(input.templateId);
  if (!definition) throw new Error('Voucher not found.');
  const name = memberNameFor(input.memberId);
  if (!name) throw new Error('Member not found.');
  const duplicate = voucherStore.vouchers.find(
    (v) => v.templateId === input.templateId && v.memberId === input.memberId,
  );
  if (duplicate) throw new Error('This member already has this voucher.');
  // Per-assignment rule wins; template rule next; platform default
  // (VOUCHER_DEFAULT_EXPIRY_DAYS) last - mirrors POST /admin/vouchers/assign.
  let defaultValidityDays: number | undefined;
  if (
    input.expiresAt === undefined &&
    input.validityDays === undefined &&
    definition.expiresAt === undefined &&
    definition.validityDays === undefined
  ) {
    const raw = configStore.entries.find((e) => e.key === 'VOUCHER_DEFAULT_EXPIRY_DAYS')?.value;
    const days = raw !== undefined && raw.trim() ? Number(raw) : NaN;
    if (Number.isInteger(days) && days > 0) defaultValidityDays = days;
  }
  const voucher: VoucherAssignment = {
    id: `vch-${seq}`,
    templateId: definition.id,
    code: nextCode(),
    title: definition.title,
    originalValue: definition.originalValue,
    remainingValue: definition.originalValue,
    status: 'ACTIVE',
    memberId: input.memberId,
    memberName: name,
    createdAt: new Date().toISOString(),
    expiresAt:
      computeMemberExpiry(
        {
          expiresAt: input.expiresAt ?? definition.expiresAt,
          validityDays: input.validityDays ?? definition.validityDays ?? defaultValidityDays,
        },
        new Date(),
      ) ?? undefined,
  };
  voucherStore.vouchers.push(voucher);
  return voucher;
}

export function scanMockVoucher(code: string): VoucherAssignment {
  const voucher = voucherStore.vouchers.find((v) => v.code === code.trim());
  if (!voucher) throw new Error('No voucher matches this code.');
  if (voucher.status === 'FULLY_REDEEMED')
    throw new Error('This voucher has already been redeemed.');
  return voucher;
}

export function redeemMockVoucher(id: string): VoucherAssignment {
  const voucher = voucherStore.vouchers.find((v) => v.id === id);
  if (!voucher) throw new Error('Voucher not found');
  if (voucher.status !== 'ACTIVE') throw new Error('This voucher has already been redeemed.');
  voucher.status = 'FULLY_REDEEMED';
  voucher.remainingValue = '0.00';
  voucher.redeemedAt = new Date().toISOString();
  voucher.redeemedBy = 'mock-staff';
  return voucher;
}

export function mockVoucherById(id: string): VoucherAssignment | undefined {
  return voucherStore.vouchers.find((v) => v.id === id);
}
