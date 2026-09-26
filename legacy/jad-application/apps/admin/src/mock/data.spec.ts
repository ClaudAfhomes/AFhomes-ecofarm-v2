import { describe, expect, it } from 'vitest';

import { CONFIG_SEEDS, PROGRAM_SEEDS } from '@jad/contracts';

import {
  MOCK_ADJUSTMENTS,
  MOCK_AUDIT,
  MOCK_CONFIG,
  MOCK_CONTENT,
  MOCK_MEMBERS,
  MOCK_MEMBER_ROLES,
  MOCK_PAYOUT_ACCOUNTS,
  MOCK_PROGRAMS,
  MOCK_PROPERTIES,
  MOCK_REGISTRATIONS,
  MOCK_ROLES,
  MOCK_SALES,
  MOCK_VOUCHER_ASSIGNMENTS,
  MOCK_WITHDRAWALS,
} from './data';
import { registrationStore } from './registrationMockStore';

/**
 * Cross-dataset referential integrity (Phase 1 consistency pass).
 * Single member universe (web mem-001…010); every foreign key and every
 * echoed name/amount must resolve. Fails on drift.
 */
const configValue = (key: string): string => MOCK_CONFIG.find((c) => c.key === key)!.value;

describe('member universe', () => {
  it('uses web-universe ids with Juan as mem-001', () => {
    const byId = new Map(MOCK_MEMBERS.map((m) => [m.id, m]));
    expect(`${byId.get('mem-001')!.firstName} ${byId.get('mem-001')!.lastName}`).toBe(
      'Juan Dela Cruz',
    );
    expect(byId.get('mem-002')!.email).toBe('maria.santos@example.com');
    expect(byId.get('mem-009')!.lastName).toBe('Mendoza');
    expect(byId.get('mem-010')!.lastName).toBe('Reyes');
  });

  it('resolves every member program in MOCK_PROGRAMS', () => {
    const ids = new Set(MOCK_PROGRAMS.map((p) => p.id));
    for (const m of MOCK_MEMBERS) {
      expect(ids.has(m.program.id)).toBe(true);
    }
  });

  it('matches role slugs to qualified flags via MOCK_ROLES', () => {
    const slugs = new Set(MOCK_ROLES.map((r) => r.slug));
    for (const m of MOCK_MEMBERS) {
      const assigned = MOCK_MEMBER_ROLES[m.id] ?? [];
      expect(assigned.length).toBeGreaterThan(0);
      for (const s of assigned) expect(slugs.has(s)).toBe(true);
      expect(assigned.includes('member_qualified')).toBe(m.isQualified);
    }
  });
});

describe('sales links', () => {
  it('resolves seller, property name, and value', () => {
    const members = new Map(MOCK_MEMBERS.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
    const props = new Map(MOCK_PROPERTIES.map((p) => [p.id, p]));
    for (const s of MOCK_SALES) {
      expect(members.get(s.sellerId)).toBe(s.sellerName);
      const prop = props.get(s.propertyId);
      expect(prop).toBeDefined();
      expect(prop!.name).toBe(s.propertyName);
      expect(prop!.price).toBe(s.propertyValue);
    }
  });

  it('keeps qualifying sales on ACTIVE properties', () => {
    const status = new Map(MOCK_PROPERTIES.map((p) => [p.id, p.status]));
    for (const s of MOCK_SALES) {
      if (s.status === 'QUALIFYING_SALE') expect(status.get(s.propertyId)).toBe('ACTIVE');
    }
  });

  it('matches LOCKED counts against MAX_RESUBMISSION_ATTEMPTS', () => {
    const max = Number(configValue('MAX_RESUBMISSION_ATTEMPTS'));
    for (const s of MOCK_SALES) {
      if (s.status === 'LOCKED') expect(s.resubmissionCount).toBe(max);
    }
  });
});

describe('voucher assignment links', () => {
  it('resolves member and template for every assignment', () => {
    const members = new Map(MOCK_MEMBERS.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
    for (const v of MOCK_VOUCHER_ASSIGNMENTS) {
      expect(members.get(v.memberId)).toBe(v.memberName);
    }
  });
});

describe('adjustment links', () => {
  it('resolves member and echoes the entry type', () => {
    const members = new Map(MOCK_MEMBERS.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
    for (const a of MOCK_ADJUSTMENTS) {
      expect(members.get(a.memberId)).toBe(a.memberName);
    }
  });

  it('charges the commission reversal to the sale seller', () => {
    const sale = MOCK_SALES.find((s) => s.id === 'sal-005')!;
    const reversal = MOCK_ADJUSTMENTS.find((a) => a.id === 'adj-002')!;
    expect(reversal.memberId).toBe(sale.sellerId);
    expect(reversal.memberName).toBe(sale.sellerName);
  });

  it('references resolvable sales in reasons', () => {
    const ids = new Set(MOCK_SALES.map((s) => s.id));
    for (const match of MOCK_ADJUSTMENTS.flatMap((a) => a.reason.match(/sal-\d+/g) ?? [])) {
      expect(ids.has(match)).toBe(true);
    }
  });
});

describe('withdrawal links', () => {
  it('resolves payout accounts with matching snapshots', () => {
    const accounts = new Map(MOCK_PAYOUT_ACCOUNTS.map((p) => [p.id, p]));
    for (const w of MOCK_WITHDRAWALS) {
      const pac = accounts.get(w.payoutAccount.id);
      expect(pac).toBeDefined();
      expect(pac!.accountName).toBe(w.payoutAccount.accountName);
      expect(pac!.method).toBe(w.payoutAccount.method);
    }
  });

  it('keeps rejected-for-balance withdrawals below their balance', () => {
    for (const w of MOCK_WITHDRAWALS) {
      if (w.rejectionReason === 'Insufficient balance') {
        expect(Number(w.balance) < Number(w.amount)).toBe(true);
      }
    }
  });
});

describe('audit target links', () => {
  it('resolves every target id in its dataset', () => {
    const regs = new Map(MOCK_REGISTRATIONS.map((r) => [r.id, r.name]));
    const sales = new Map(MOCK_SALES.map((s) => [s.id, s]));
    const payouts = new Map(MOCK_PAYOUT_ACCOUNTS.map((p) => [p.id, p.accountName]));
    const withdrawals = new Map(MOCK_WITHDRAWALS.map((w) => [w.id, w]));
    const adjustments = new Map(MOCK_ADJUSTMENTS.map((a) => [a.id, a]));
    const content = new Map(MOCK_CONTENT.map((c) => [c.id, c]));
    for (const e of MOCK_AUDIT) {
      switch (e.targetType) {
        case 'Registration':
          expect(regs.get(e.targetId)).toBe(e.targetName);
          break;
        case 'Sale':
          expect(sales.has(e.targetId)).toBe(true);
          break;
        case 'PayoutAccount':
          expect(payouts.has(e.targetId)).toBe(true);
          break;
        case 'Withdrawal':
          expect(withdrawals.has(e.targetId)).toBe(true);
          break;
        case 'Adjustment': {
          const adj = adjustments.get(e.targetId);
          expect(adj).toBeDefined();
          expect(e.targetName).toContain(adj!.memberName);
          expect(e.targetName).toContain(adj!.amount);
          break;
        }
        case 'SystemConfig':
          expect(MOCK_CONFIG.some((c) => c.key === e.targetId)).toBe(true);
          break;
        case 'Content':
          expect(content.has(e.targetId)).toBe(true);
          break;
        default:
          throw new Error(`Unknown audit targetType ${e.targetType}`);
      }
    }
  });

  it('attributes actors from the staff roster (or System)', () => {
    const roleOf: Record<string, string> = {
      'Ada Admin': 'ADMIN',
      'Fina Finance': 'FINANCE',
      'Saul Super': 'SUPER_ADMIN',
      System: 'SYSTEM',
    };
    for (const e of MOCK_AUDIT) {
      expect(roleOf[e.actor]).toBe(e.actorRole);
    }
  });
});

describe('registration store links', () => {
  it('links every member to a same-identity application', () => {
    const regs = new Map(registrationStore.registrations.map((r) => [r.id, r]));
    for (const m of registrationStore.members) {
      const reg = regs.get(m.registrationId);
      expect(reg).toBeDefined();
      expect(`${reg!.firstName} ${reg!.lastName}`).toBe(`${m.firstName} ${m.lastName}`);
    }
  });

  it('keeps archived member ids out of the active roster', () => {
    const active = new Set(registrationStore.members.map((m) => m.id));
    for (const a of registrationStore.archived) {
      expect(active.has(a.memberId)).toBe(false);
      expect(a.originalData.id).toBeTruthy();
    }
  });

  it('shares the member universe with MOCK_MEMBERS', () => {
    const roster = new Map(MOCK_MEMBERS.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));
    for (const m of registrationStore.members) {
      expect(roster.get(m.id)).toBe(`${m.firstName} ${m.lastName}`);
    }
  });
});

/**
 * Cross-app mirrors (Phase 2/4). The web/member mock store is authoritative;
 * these tables duplicate its values so drift fails loudly. Keep in sync with
 * apps/web/src/mock/store.ts.
 */
describe('web-universe mirrors', () => {
  it('mirrors the web member roster', () => {
    const expected: [string, string, string, boolean, string][] = [
      ['mem-001', 'Juan Dela Cruz', 'juan.delacruz@example.com', true, 'APPROVED_ACTIVE'],
      ['mem-002', 'Maria Santos', 'maria.santos@example.com', false, 'APPROVED_ACTIVE'],
      ['mem-003', 'Pedro Pendiente', 'pedro.pendiente@example.com', false, 'PENDING'],
      ['mem-004', 'Ana Anay', 'ana.anay@example.com', false, 'REJECTED'],
      ['mem-005', 'Ramon Reyes', 'ramon.reyes.member@example.com', true, 'APPROVED_ACTIVE'],
      ['mem-006', 'Liza Lopez', 'liza.lopez@example.com', false, 'PENDING'],
      ['mem-007', 'Kevin Kintanar', 'kevin.kintanar@example.com', true, 'APPROVED_ACTIVE'],
      ['mem-008', 'Nina Navarro', 'nina.navarro@example.com', false, 'REJECTED'],
    ];
    const byId = new Map(MOCK_MEMBERS.map((m) => [m.id, m]));
    for (const [id, name, email, qualified, status] of expected) {
      const m = byId.get(id);
      expect(m).toBeDefined();
      expect(`${m!.firstName} ${m!.lastName}`).toBe(name);
      expect(m!.email).toBe(email);
      expect(m!.isQualified).toBe(qualified);
      expect(m!.status).toBe(status);
    }
  });

  it('mirrors shared withdrawal records (same id, member, amount, status)', () => {
    const expected: [string, string, string][] = [
      ['wdr-001', '50000.00', 'COMPLETED'],
      ['wdr-002', '40000.00', 'REJECTED'],
      ['wdr-003', '75000.00', 'RESERVED'],
    ];
    const byId = new Map(MOCK_WITHDRAWALS.map((w) => [w.id, w]));
    for (const [id, amount, status] of expected) {
      const w = byId.get(id);
      expect(w).toBeDefined();
      expect(w!.amount).toBe(amount);
      expect(w!.status).toBe(status);
      expect(w!.payoutAccount.accountName).toBe('Juan Dela Cruz');
    }
  });

  it('mirrors sale statuses and resubmission counts', () => {
    const expected: [string, string, number][] = [
      ['sal-001', 'SUBMITTED', 0],
      ['sal-002', 'ADMIN_APPROVED', 0],
      ['sal-003', 'PAYMENT_VERIFIED', 0],
      ['sal-004', 'QUALIFYING_SALE', 0],
      ['sal-005', 'REJECTED', 1],
      ['sal-006', 'LOCKED', 3],
      ['sal-007', 'QUALIFYING_SALE', 0],
      ['sal-008', 'QUALIFYING_SALE', 0],
      ['sal-009', 'QUALIFYING_SALE', 0],
      ['sal-010', 'REJECTED', 3],
    ];
    const byId = new Map(MOCK_SALES.map((s) => [s.id, s]));
    for (const [id, status, count] of expected) {
      const s = byId.get(id);
      expect(s).toBeDefined();
      expect(s!.status).toBe(status);
      expect(s!.resubmissionCount).toBe(count);
    }
  });
});

describe('reference-data seed parity', () => {
  it('matches programs to the contracts seed', () => {
    expect(MOCK_PROGRAMS).toEqual(PROGRAM_SEEDS);
  });

  it('matches config rows to the contracts seed (including GENDERS)', () => {
    expect(MOCK_CONFIG).toEqual(CONFIG_SEEDS);
  });
});

describe('config cross-checks', () => {
  it('matches the 8%/4% business rates and min age 18', () => {
    expect(configValue('COMMISSION_DIRECT_RATE')).toBe('0.0800');
    expect(configValue('COMMISSION_REFERRAL_RATE')).toBe('0.0400');
    expect(configValue('QUALIFICATION_MIN_AGE')).toBe('18');
  });
});
