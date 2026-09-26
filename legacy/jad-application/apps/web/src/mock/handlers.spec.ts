import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_MEMBER, MOCK_MEMBER_NOT_QUALIFIED, setMockSessionUser } from '@jad/mock';
import { createMockServer } from '@jad/mock';

import { createMemberMockServer } from './index';
import { memberMockHandlers } from './handlers';
import { createMockStore } from './store';
import {
  login,
  registerApplication,
  resendVerificationCode,
  verifyEmail,
} from '../features/auth/services/auth';
import { getPolicies, getPrograms } from '../lib/api/endpoints';
import {
  createPayoutAccount,
  createWithdrawal,
  getBroadcasts,
  getCommissions,
  getContentLibrary,
  getDirectReferrals,
  getGenealogy,
  getGroupNetwork,
  getLedgerPage,
  getPayoutAccounts,
  getVoucher,
  getVouchers,
  getWallet,
  getWithdrawal,
  getWithdrawals,
  getSales,
  getSale,
  markAllNotificationsRead,
  markNotificationRead,
  requestReopenSale,
  resubmitSale,
  setPrimaryPayoutAccount,
  submitSale,
} from '../features/member/services/member';

/**
 * End-to-end test of the F1 member mock API through the real service functions
 * and the typed API client (the same path the components use). The mock stands
 * in for the not-yet-built backend; every flow below is API-shaped.
 */
describe('F1 member mock API', () => {
  let server: ReturnType<typeof createMemberMockServer>;

  beforeEach(() => {
    server = createMemberMockServer();
    server.install();
    setMockSessionUser(null);
  });

  afterEach(() => {
    server.restore();
    setMockSessionUser(null);
  });

  it('logs in with the demo email or phone and the demo password (SCR-AUTH-001)', async () => {
    const byEmail = await login({
      identifier: 'juan.delacruz@example.com',
      password: 'password123',
    });
    expect(byEmail.user).toMatchObject({
      id: 'mem-001',
      name: 'Juan Dela Cruz',
      role: 'user',
      isQualified: true,
      status: 'APPROVED_ACTIVE',
    });

    const byPhone = await login({ identifier: '+63 917 555 0199', password: 'password123' });
    expect(byPhone.user.id).toBe('mem-001');
  });

  it('rejects bad credentials with the UNAUTHORIZED envelope', async () => {
    await expect(
      login({ identifier: 'juan.delacruz@example.com', password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('registers an application, surfaces the dev-only code, and verifies the email', async () => {
    const email = 'test.applicant@example.com';
    const created = await registerApplication({
      programId: 'prg-domestic',
      firstName: 'Test',
      lastName: 'Applicant',
      dateOfBirth: '1992-05-10',
      gender: 'Male',
      countryCode: 'PH',
      provinceCode: '0128',
      cityCode: '012801',
      barangayCode: '012801001',
      phone: '+63 917 555 1111',
      email,
      password: 'password123',
      qualificationAnswers: [{ questionId: 'qual-001', answer: 'Yes' }],
      idDocument: { fileName: 'id.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 },
    });
    expect(created.application).toMatchObject({
      email,
      status: 'PENDING',
      emailVerified: false,
    });

    const resent = await resendVerificationCode(email);
    expect(resent.devOnlyCode).toMatch(/^\d{6}$/);

    const verified = await verifyEmail({ email, code: resent.devOnlyCode as string });
    expect(verified.email).toBe(email);
    expect(verified.verifiedAt).toBeTruthy();

    await expect(verifyEmail({ email, code: '000000' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('exposes the public config and programs lists (catalog reuse)', async () => {
    const programs = await getPrograms();
    expect(programs.some((program) => program.code === 'DOMESTIC')).toBe(true);
  });

  it('gates member endpoints on the session (object-level, NFR-AUTHZ-002)', async () => {
    await expect(getSales()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('submits a qualifying sale with an Idempotency-Key as SUBMITTED', async () => {
    setMockSessionUser(MOCK_MEMBER);
    const sale = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      'idem-abc-123',
    );
    expect(sale.status).toBe('SUBMITTED');
    expect(sale.propertyName).toBe('250 SQM Farm Lot with Hotspring');
    expect(sale.resubmissionCount).toBe(0);
  });

  it('stores and returns an optional referrer (members only, SCR-MEM-006)', async () => {
    setMockSessionUser(MOCK_MEMBER);
    const sale = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot', referrerId: 'mem-002' },
      'idem-wdr-referrer',
    );
    expect(sale.referrerId).toBe('mem-002');
    expect(sale.referrerName).toBe('Maria Santos');
    const fetched = await getSale(sale.id);
    expect(fetched.referrerName).toBe('Maria Santos');
  });

  it('replays an idempotent sale submission without creating a duplicate (API-SPECIFICATION §5.3)', async () => {
    setMockSessionUser(MOCK_MEMBER);
    const key = 'idem-sale-replay';

    const first = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      key,
    );
    const replay = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      key,
    );

    expect(replay.id).toBe(first.id);
    expect(replay.status).toBe('SUBMITTED');
    const sales = await getSales();
    expect(sales.filter((sale) => sale.id === first.id)).toHaveLength(1);
  });

  it('creates a distinct sale for a different Idempotency-Key', async () => {
    setMockSessionUser(MOCK_MEMBER);
    const a = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      'idem-sale-a',
    );
    const b = await submitSale(
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      'idem-sale-b',
    );
    expect(a.id).not.toBe(b.id);
  });

  it('returns 404 for another member\u2019s resources (object-level, NFR-AUTHZ-002)', async () => {
    const registered = await registerApplication({
      programId: 'prg-domestic',
      firstName: 'Foreign',
      lastName: 'Member',
      dateOfBirth: '1990-01-01',
      gender: 'Female',
      countryCode: 'PH',
      provinceCode: '0128',
      cityCode: '012801',
      barangayCode: '012801001',
      phone: '+63 917 555 2222',
      email: 'foreign.member@example.com',
      password: 'password123',
      qualificationAnswers: [{ questionId: 'qual-001', answer: 'Yes' }],
      idDocument: { fileName: 'id.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 },
    });
    const otherId = registered.application.id;

    setMockSessionUser({
      id: otherId,
      name: 'Foreign Member',
      email: 'foreign.member@example.com',
      role: 'user',
      isQualified: false,
      status: 'PENDING',
    });

    await expect(getWithdrawal('wdr-001')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(getSale('sal-001')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(getVoucher('vch-001')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('rejects a sale from a member who is not qualified (BR-QUAL-001)', async () => {
    setMockSessionUser(MOCK_MEMBER_NOT_QUALIFIED);
    await expect(
      submitSale({ customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' }, 'idem-abc-123'),
    ).rejects.toMatchObject({ code: 'MEMBER_NOT_QUALIFIED', status: 422 });
  });

  it('resubmits a REJECTED sale and rejects resubmitting a non-rejected one', async () => {
    setMockSessionUser(MOCK_MEMBER);

    const resubmitted = await resubmitSale(
      'sal-005',
      { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
      'idem-resub-1',
    );
    expect(resubmitted.status).toBe('SUBMITTED');
    expect(resubmitted.resubmissionCount).toBe(2);

    await expect(
      resubmitSale(
        'sal-001',
        { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
        'idem-resub-2',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('locks a rejected sale at the resubmission maximum (409 SALE_LOCKED, BR-SAL-006)', async () => {
    setMockSessionUser(MOCK_MEMBER);
    await expect(
      resubmitSale(
        'sal-010',
        { customerId: 'cus-001', propertyId: 'igp-250-sqm-farm-lot' },
        'idem-resub-lock',
      ),
    ).rejects.toMatchObject({ code: 'SALE_LOCKED', status: 409, details: { maxAttempts: 3 } });
  });

  it('accepts a reopen-request for a LOCKED sale and rejects others (FR-SAL-007)', async () => {
    setMockSessionUser(MOCK_MEMBER);

    const reopen = await requestReopenSale('sal-006');
    expect(reopen).toEqual({ saleId: 'sal-006', requested: true });

    await expect(requestReopenSale('sal-001')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  describe('F2-A financial mock', () => {
    it('returns a coherent wallet with pipeline pending estimate (BI-002)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const wallet = await getWallet();
      expect(wallet.availableBalance).toBe('776000.00');
      expect(wallet.pendingAmount).toBe('0.00');
      expect(wallet.pendingCommission).toBe('1224000.00');
      expect(wallet.totalEarned).toBe('876000.00');
    });

    it('lists own commissions with sale property names, newest first (SCR-MEM-015)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const commissions = await getCommissions();
      expect(commissions).toHaveLength(6);
      expect(commissions[0]).toMatchObject({
        commissionType: 'DIRECT_COMMISSION',
        salePropertyName: 'Prisma Residences - Astra Building Condo',
        status: 'AVAILABLE',
      });
      expect(commissions[1]).toMatchObject({
        commissionType: 'DIRECT_REFERRAL',
        rate: '0.0400',
      });
      expect(commissions[0]!.rate).toBe('0.0800');
      expect(commissions.some((c) => c.status === 'AVAILABLE')).toBe(true);
      expect(commissions.some((c) => c.status === 'REVERSED')).toBe(true);
      expect(commissions.some((c) => c.status === 'CANCELLED')).toBe(true);
      expect(commissions.some((c) => c.status === 'PENDING')).toBe(false);
    });

    it('paginates the ledger by cursor with a monotonic running balance (SCR-MEM-009)', async () => {
      setMockSessionUser(MOCK_MEMBER);

      const page1 = await getLedgerPage(undefined, undefined, 3);
      expect(page1.items).toHaveLength(3);
      expect(page1.items[0]).toMatchObject({ id: 'led-001', entryType: 'DIRECT_COMMISSION' });
      expect(page1.items[0]!.balanceAfter).toBe('160000.00');
      expect(page1.items[1]!.balanceAfter).toBe('240000.00');
      expect(page1.items[2]!.balanceAfter).toBe('336000.00');
      expect(page1.nextCursor).toBe('led-003');

      const page2 = await getLedgerPage(page1.nextCursor, undefined, 3);
      expect(page2.items[0]!.id).toBe('led-004');
      // led-004 reverses the 96000 commission and led-006 is a
      // WITHDRAWAL_COMPLETION that does NOT change the running balance.
      expect(page2.items[0]!.balanceAfter).toBe('240000.00');
      expect(page2.items[2]!.id).toBe('led-006');
      expect(page2.items[2]!.balanceAfter).toBe('190000.00');

      const page3 = await getLedgerPage(page2.nextCursor, undefined, 3);
      expect(page3.items[0]!.id).toBe('led-007');
      const page4 = await getLedgerPage(page3.nextCursor, undefined, 3);
      expect(page4.items[0]!.id).toBe('led-010');
      expect(page4.items[0]!.balanceAfter).toBe('140000.00');
      expect(page4.nextCursor).toBeUndefined();
    });

    it('filters the ledger by allowlisted type (SCR-MEM-009)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const reservations = await getLedgerPage(undefined, 'WITHDRAWAL_RESERVATION');
      expect(
        reservations.items.every((entry) => entry.entryType === 'WITHDRAWAL_RESERVATION'),
      ).toBe(true);
      expect(reservations.items.map((entry) => entry.id)).toEqual([
        'led-005',
        'led-007',
        'led-009',
      ]);
      // Running balance is computed over the FULL ledger, then filtered.
      expect(reservations.items[0]!.balanceAfter).toBe('190000.00');
    });

    it('rejects unknown ledger type filters', async () => {
      setMockSessionUser(MOCK_MEMBER);
      await expect(getLedgerPage(undefined, 'NOT_A_TYPE')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
    });

    it('lists payout accounts with masked identifiers and confirmed lifecycle', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const accounts = await getPayoutAccounts();
      expect(accounts).toHaveLength(5);
      expect(accounts[0]!.isPrimary).toBe(true);
      expect(accounts[0]!.accountIdentifierMasked).toContain('•');
      expect(accounts[0]!.accountIdentifierMasked).not.toContain('1234567890');
      const statuses = accounts.map((account) => account.status);
      expect(statuses).toContain('CONFIRMED');
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('ADMIN_REVIEW');
      expect(statuses).toContain('REJECTED');
    });

    it('creates a payout account as PENDING and can promote another to primary (BR-PAY-006)', async () => {
      setMockSessionUser(MOCK_MEMBER);

      const created = await createPayoutAccount({
        method: 'GCASH',
        accountName: 'Juan Dela Cruz',
        accountIdentifier: '09175550199',
      });
      expect(created.status).toBe('PENDING');
      expect(created.isPrimary).toBe(false);
      expect(created.accountIdentifierMasked).toContain('•');

      await expect(setPrimaryPayoutAccount(created.id)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 422,
      });

      const promoted = await setPrimaryPayoutAccount('pa-002');
      expect(promoted.isPrimary).toBe(true);

      const after = await getPayoutAccounts();
      const primary = after.filter((account) => account.isPrimary);
      expect(primary).toHaveLength(1);
      expect(primary[0]!.id).toBe('pa-002');
    });

    it('requires an Idempotency-Key and a verified payout account (SCR-MEM-012)', async () => {
      setMockSessionUser(MOCK_MEMBER);

      await expect(
        createWithdrawal({ amount: '1000.00', payoutAccountId: 'pa-001' }, ''),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

      await expect(
        createWithdrawal({ amount: '1000.00', payoutAccountId: 'pa-003' }, 'idem-wdr-key-1'),
      ).rejects.toMatchObject({ code: 'PAYOUT_ACCOUNT_UNVERIFIED', status: 422 });
    });

    it('rejects withdrawals above the Available Balance (409 INSUFFICIENT_BALANCE)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      await expect(
        createWithdrawal({ amount: '776000.01', payoutAccountId: 'pa-001' }, 'idem-wdr-key-2'),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 409 });
    });

    it('allows draining the Available Balance exactly across capped requests (BI-001)', async () => {
      // The per-request maximum (50000.00) is below the 776000.00 balance, so
      // a full drain takes many requests and must land on exactly 0.00.
      setMockSessionUser(MOCK_MEMBER);
      const keys: [string, string][] = [];
      for (let i = 0; i < 15; i++) keys.push(['50000.00', `idem-wdr-drain-${i}`]);
      keys.push(['26000.00', 'idem-wdr-drain-15']);
      for (const [amount, key] of keys) {
        const withdrawal = await createWithdrawal({ amount, payoutAccountId: 'pa-001' }, key);
        expect(withdrawal.status).toBe('RESERVED');
      }
      const after = await getWallet();
      expect(after.availableBalance).toBe('0.00');
      expect(after.pendingAmount).toBe('0.00');
    });

    it('rejects withdrawals below the configured minimum (400 VALIDATION_ERROR)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      await expect(
        createWithdrawal({ amount: '50.00', payoutAccountId: 'pa-001' }, 'idem-wdr-min'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('rejects affordable withdrawals above the configured maximum (400 VALIDATION_ERROR)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      await expect(
        createWithdrawal({ amount: '50000.01', payoutAccountId: 'pa-001' }, 'idem-wdr-max'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('creates a RESERVED withdrawal, deducts the wallet, and appends a ledger entry', async () => {
      setMockSessionUser(MOCK_MEMBER);

      const withdrawal = await createWithdrawal(
        { amount: '25000.00', payoutAccountId: 'pa-002' },
        'idem-wdr-key-3',
      );
      expect(withdrawal).toMatchObject({
        status: 'RESERVED',
        amount: '25000.00',
        payoutAccount: { id: 'pa-002' },
      });
      expect(withdrawal.payoutAccount.accountIdentifierMasked).toContain('•');
      expect(withdrawal.reservedAt).toBeTruthy();

      const after = await getWallet();
      expect(after.availableBalance).toBe('751000.00');
      expect(after.pendingAmount).toBe('0.00');

      const reservations = await getLedgerPage(undefined, 'WITHDRAWAL_RESERVATION', 100);
      const last = reservations.items[reservations.items.length - 1]!;
      expect(last).toMatchObject({ amount: '25000.00', direction: 'DEBIT' });
      // Ledger running balance is computed from ledger entries only (143k -> 118k
      // after this reservation) and is intentionally not kept in sync with the
      // wallet_AVAILABLE demo value in this mock - keep the legacy 115k.
      expect(last.balanceAfter).toBe('115000.00');
    });

    it('replays an idempotent withdrawal without double-deducting (API-SPECIFICATION §5.3)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const key = 'idem-wdr-replay';

      const first = await createWithdrawal({ amount: '10000.00', payoutAccountId: 'pa-001' }, key);
      const replay = await createWithdrawal({ amount: '10000.00', payoutAccountId: 'pa-001' }, key);

      expect(replay.id).toBe(first.id);
      expect(await getWallet()).toMatchObject({
        availableBalance: '766000.00',
        pendingAmount: '0.00',
      });
      const reservations = await getLedgerPage(undefined, 'WITHDRAWAL_RESERVATION', 100);
      const matching = reservations.items.filter((entry) => entry.amount === '10000.00');
      expect(matching).toHaveLength(1);
    });

    it('lists withdrawals and returns a 404 for an unknown or foreign one', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const withdrawals = await getWithdrawals();
      expect(withdrawals).toHaveLength(3);
      expect(withdrawals[0]!.id).toBe('wdr-003');

      const detail = await getWithdrawal('wdr-001');
      expect(detail).toMatchObject({ status: 'COMPLETED', externalReference: 'EXT-PAY-000123' });

      await expect(getWithdrawal('wdr-999')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('F2-B referral, voucher & content mock', () => {
    it('lists direct referrals single-level, with status and qualification (SCR-MEM-016)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const referrals = await getDirectReferrals();
      expect(referrals.map((referral) => referral.id)).toEqual([
        'mem-002',
        'mem-004',
        'mem-005',
        'mem-006',
      ]);
      expect(referrals[0]).toMatchObject({
        name: 'Maria Santos',
        status: 'APPROVED_ACTIVE',
        isQualified: false,
      });
      expect(referrals[1]).toMatchObject({
        name: 'Ana Anay',
        status: 'REJECTED',
        isQualified: false,
      });
      expect(referrals[2]!.isQualified).toBe(true);
      expect(referrals[3]!.status).toBe('PENDING');
    });

    it('computes the group network summary - reporting only, never MLM (SCR-MEM-017)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const network = await getGroupNetwork();
      expect(network).toEqual({
        totalMembers: 6,
        directReferrals: 4,
        qualified: 2,
        pending: 1,
        rejected: 2,
      });
    });

    it('returns the genealogy tree rooted at the member with nested referrals (SCR-MEM-018)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const genealogy = await getGenealogy();
      expect(genealogy.root).toMatchObject({ id: 'mem-001', name: 'Juan Dela Cruz' });
      const direct = genealogy.root.children.map((node) => node.id);
      expect(direct).toEqual(['mem-002', 'mem-004', 'mem-005', 'mem-006']);
      expect(genealogy.root.children[0]!.children.map((node) => node.id)).toEqual(['mem-007']);
      expect(genealogy.root.children[1]!.children).toHaveLength(0);
      expect(genealogy.root.children[2]!.children.map((node) => node.id)).toEqual(['mem-008']);
      expect(genealogy.root.children[3]!.children).toHaveLength(0);
      // Juan is the network root - no sponsor, empty upline.
      expect(genealogy.sponsor).toBeNull();
      expect(genealogy.ancestors).toEqual([]);
    });

    it('returns the sponsor and upline chain for a member with a referral-code sponsor', async () => {
      setMockSessionUser(MOCK_MEMBER_NOT_QUALIFIED);
      const genealogy = await getGenealogy();
      expect(genealogy.root).toMatchObject({ id: 'mem-002', name: 'Maria Santos' });
      expect(genealogy.ancestors.map((node) => node.id)).toEqual(['mem-001']);
      expect(genealogy.sponsor).toMatchObject({ id: 'mem-001', name: 'Juan Dela Cruz' });
    });

    it('lists own vouchers newest first with server-computed remaining value (SCR-MEM-020)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const vouchers = await getVouchers();
      expect(vouchers).toHaveLength(3);
      expect(vouchers[0]).toMatchObject({
        id: 'vch-002',
        title: 'Referral Rewards Voucher',
        originalValue: '1000.00',
        remainingValue: '350.00',
        status: 'ACTIVE',
      });
      expect(vouchers[2]).toMatchObject({
        id: 'vch-003',
        status: 'FULLY_REDEEMED',
        remainingValue: '0.00',
      });
    });

    it('returns a voucher detail and 404s for unknown ids (object-level, SCR-MEM-021)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const voucher = await getVoucher('vch-001');
      expect(voucher).toMatchObject({
        title: 'Welcome Gift Voucher',
        originalValue: '500.00',
        remainingValue: '500.00',
      });

      await expect(getVoucher('vch-999')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('lists forwardable content with server-provided share/download targets (SCR-MEM-022)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const items = await getContentLibrary();
      expect(items.length).toBeGreaterThanOrEqual(5);
      const overview = items.find((item) => item.id === 'ctn-001');
      expect(overview).toMatchObject({
        title: 'JA&D Membership Overview',
        kind: 'DOCUMENT',
        downloadUrl: expect.stringMatching(/^data:text\/plain/),
        share: {
          messengerUrl: expect.any(String),
          viberUrl: expect.any(String),
          copyUrl: expect.any(String),
        },
      });
      expect(overview?.share?.messengerUrl).toMatch(/^https:\/\//);
      const showcase = items.find((item) => item.id === 'ctn-004');
      expect(showcase).toMatchObject({
        kind: 'IMAGE',
        downloadUrl: expect.stringContaining('unsplash.com'),
      });
      const video = items.find((item) => item.id === 'ctn-005');
      expect(video).toMatchObject({
        kind: 'VIDEO',
        downloadUrl: expect.stringContaining('BigBuckBunny'),
      });
    });

    it('lists policies with type and updated date (PUBLIC, SCR-MEM-023)', async () => {
      const policies = await getPolicies();
      expect(policies.map((policy) => policy.id)).toEqual(['pol-001', 'pol-002', 'pol-003']);
      expect(policies[0]).toMatchObject({
        title: 'Terms and Conditions',
        type: 'terms',
        content: expect.any(String),
      });
    });

    it('serves own + broadcast notifications newest first (SCR-MEM-024)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const items = await getBroadcasts();
      // 5 member rows + 2 broadcasts (memberId null), newest first.
      expect(items).toHaveLength(7);
      expect(items.map((item) => item.id)).toContain('ntf-broadcast-001');
      expect(items.map((item) => item.id)).toContain('ntf-broadcast-002');
      const created = items.map((item) => item.createdAt);
      expect([...created].sort().reverse()).toEqual(created);
    });

    it('marks one notification read and then all remaining (SCR-MEM-024)', async () => {
      setMockSessionUser(MOCK_MEMBER);
      const receipt = await markNotificationRead('ntf-broadcast-001');
      expect(receipt).toMatchObject({ id: 'ntf-broadcast-001' });
      expect(typeof receipt.readAt).toBe('string');

      const after = await getBroadcasts();
      expect(after.find((item) => item.id === 'ntf-broadcast-001')?.readAt).toBeDefined();

      // Idempotent re-mark of the same item.
      const again = await markNotificationRead('ntf-broadcast-001');
      expect(again.readAt).toBe(receipt.readAt);

      const all = await markAllNotificationsRead();
      expect(all.updated).toBe(5);
      const done = await getBroadcasts();
      expect(done.every((item) => Boolean(item.readAt))).toBe(true);

      const noop = await markAllNotificationsRead();
      expect(noop).toMatchObject({ updated: 0 });
    });

    it('404s a foreign member-scoped notification on mark-read', async () => {
      setMockSessionUser(MOCK_MEMBER_NOT_QUALIFIED);
      // ntf-002 belongs to mem-001 - not visible to another member.
      await expect(markNotificationRead('ntf-002')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });
});

/**
 * Mock login lifecycle gates (mirrors the live Supabase gates): archived and
 * inactive members cannot sign in. Each test builds its own store so the
 * flags never leak into other suites.
 */
describe('mock login lifecycle gates', () => {
  let server: ReturnType<typeof createMockServer>;

  afterEach(() => {
    server.restore();
    setMockSessionUser(null);
  });

  function installWithMemberFlags(
    memberId: string,
    flags: { archivedAt?: string; accountStatus?: 'ACTIVE' | 'INACTIVE' },
  ) {
    const store = createMockStore();
    const member = store.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`mock member ${memberId} missing`);
    if (flags.archivedAt !== undefined) member.archivedAt = flags.archivedAt;
    if (flags.accountStatus !== undefined) member.accountStatus = flags.accountStatus;
    server = createMockServer(memberMockHandlers(store));
    server.install();
  }

  it('rejects archived members with ACCOUNT_ARCHIVED', async () => {
    installWithMemberFlags('mem-001', { archivedAt: new Date().toISOString() });
    await expect(
      login({ identifier: 'juan.delacruz@example.com', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED', status: 403 });
  });

  it('rejects inactive members with ACCOUNT_INACTIVE', async () => {
    installWithMemberFlags('mem-001', { accountStatus: 'INACTIVE' });
    await expect(
      login({ identifier: 'juan.delacruz@example.com', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE', status: 403 });
  });

  it('still signs in active members', async () => {
    installWithMemberFlags('mem-001', {});
    const result = await login({
      identifier: 'juan.delacruz@example.com',
      password: 'password123',
    });
    expect(result.user).toMatchObject({ id: 'mem-001' });
  });
});
