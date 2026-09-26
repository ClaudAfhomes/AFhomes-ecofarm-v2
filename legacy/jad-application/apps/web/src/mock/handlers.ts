import { addMoney, compareMoney, subtractMoney } from '@jad/shared';
import {
  createCustomerRequestSchema,
  createPayoutAccountRequestSchema,
  createWithdrawalRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  setPrimaryPayoutAccountRequestSchema,
  submitSaleRequestSchema,
  verifyEmailRequestSchema,
} from '@jad/contracts';
import type {
  Commission,
  DirectReferral,
  GenealogyNode,
  GroupNetwork,
  MemberProfile,
  PayoutAccount,
  RegistrationApplication,
  Sale,
  SaleStatus,
  SessionUser,
  Voucher,
  Withdrawal,
} from '@jad/contracts';
import { MOCK_SUPER_ADMIN, mockSessionRef } from '@jad/mock';
import type { MockRequestContext, MockRoute } from '@jad/mock';

import { ARCHIVED_ACCOUNT_MESSAGE, INACTIVE_ACCOUNT_MESSAGE } from '../lib/api/orphan';

import {
  ageFromDateOfBirth,
  hashPassword,
  maskIdentifier,
  type MockCommission,
  type MockMember,
  type MockPayoutAccount,
  type MockSale,
  type MockStore,
  type MockVoucher,
  type MockWithdrawal,
} from './store';

/** Configurable sale resubmission maximum (BR-SAL-006; configurable default 3). */
export const MAX_SALE_RESUBMISSIONS = 3;

function error(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): { body: unknown; status: number } {
  return {
    body: {
      error: {
        code,
        message,
        details,
        timestamp: new Date().toISOString(),
      },
    },
    status,
  };
}

function ok(body: unknown): { body: unknown; status: number } {
  return { body, status: 200 };
}

function created(body: unknown): { body: unknown; status: number } {
  return { body, status: 201 };
}

function unauthorized(): { body: unknown; status: number } {
  return error('UNAUTHORIZED', 'You must be signed in to continue.', 401);
}

function validationError(message: string): { body: unknown; status: number } {
  // API-SPECIFICATION §1.2: malformed request / validation error → 400
  // (422 is reserved for business-rule violations).
  return error('VALIDATION_ERROR', message, 400);
}

function currentMember(store: MockStore): MockMember | undefined {
  const session = mockSessionRef.current;
  if (!session?.id) return undefined;
  const found = store.members.find((member) => member.id === session.id);
  if (found) return found;
  // Supabase Auth users have UUIDs (e.g. admin@jad.local) not in mock store (mem-001).
  // For Phase 1, treat any authenticated Supabase user as the first mock member
  // so /me/wallet, /me/sales, /me/genealogy return rich demo data instead of 401.
  // Profile/name is still driven by useSession().user, not this fallback.
  return store.members[0];
}

function toSessionUser(member: MockMember): SessionUser {
  return {
    id: member.id,
    name: `${member.firstName} ${member.lastName}`,
    email: member.email,
    role: 'user',
    isQualified: member.isQualified,
    status: member.status,
  };
}

function toApplication(member: MockMember): RegistrationApplication {
  return {
    id: member.id,
    email: member.email,
    status: member.status,
    emailVerified: member.isEmailVerified,
    createdAt: new Date().toISOString(),
  };
}

function toProfile(member: MockMember, store: MockStore): MemberProfile {
  const program = store.programs.find((candidate) => candidate.id === member.programId);
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    middleInitial: member.middleInitial,
    nameSuffix: member.nameSuffix,
    dateOfBirth: member.dateOfBirth,
    age: member.age,
    gender: member.gender,
    address: member.address,
    countryCode: member.countryCode,
    countryName: member.countryName,
    phone: member.phone,
    email: member.email,
    referralCode: member.referralCode,
    status: member.status,
    isQualified: member.isQualified,
    program: program
      ? { id: program.id, code: program.code, name: program.name }
      : { id: member.programId, code: 'UNKNOWN', name: 'Unknown program' },
  };
}

function toSale(sale: MockSale): Sale {
  return {
    id: sale.id,
    status: sale.status,
    propertyId: sale.propertyId,
    propertyName: sale.propertyName,
    propertyValue: sale.propertyValue,
    customerId: sale.customerId,
    customerName: sale.customerName,
    sellerId: sale.sellerId,
    sellerName: sale.sellerName,
    resubmissionCount: sale.resubmissionCount,
    rejectionReason: sale.rejectionReason,
    submittedAt: sale.submittedAt,
    approvedAt: sale.approvedAt,
    paymentVerifiedAt: sale.paymentVerifiedAt,
    lockedAt: sale.lockedAt,
    referrerId: (sale as { referrerId?: string }).referrerId,
    referrerName: sale.referrerName,
  };
}

function list(data: unknown[]): { body: unknown; status: number } {
  return ok({ data, meta: {} });
}

function toCommission(commission: MockCommission, store: MockStore): Commission {
  const sale = store.sales.find((candidate) => candidate.id === commission.saleId);
  return {
    id: commission.id,
    commissionType: commission.commissionType,
    saleId: commission.saleId,
    salePropertyName: sale?.propertyName ?? commission.saleId,
    baseValue: commission.baseValue,
    rate: commission.rate,
    amount: commission.amount,
    status: commission.status,
    clearedAt: commission.clearedAt,
    cancelledAt: commission.cancelledAt,
    reversedAt: commission.reversedAt,
    createdAt: commission.createdAt,
  };
}

function toPayoutAccount(account: MockPayoutAccount): PayoutAccount {
  return {
    id: account.id,
    method: account.method,
    accountName: account.accountName,
    accountIdentifierMasked: maskIdentifier(account.accountIdentifier),
    accountIdentifier: account.accountIdentifier,
    status: account.status,
    isPrimary: account.isPrimary,
    createdAt: account.createdAt,
    rejectionReason: account.rejectionReason,
  };
}

function toWithdrawal(withdrawal: MockWithdrawal, store: MockStore): Withdrawal {
  const account = store.payoutAccounts.find(
    (candidate) => candidate.id === withdrawal.payoutAccountId,
  );
  return {
    id: withdrawal.id,
    amount: withdrawal.amount,
    status: withdrawal.status,
    payoutAccount: {
      id: account?.id ?? withdrawal.payoutAccountId,
      method: account?.method ?? 'OTHER',
      accountName: account?.accountName ?? 'Payout account',
      accountIdentifierMasked: account
        ? maskIdentifier(account.accountIdentifier)
        : '\u2022\u2022\u2022\u2022',
      ...(account ? { accountIdentifier: account.accountIdentifier } : {}),
    },
    reservedAt: withdrawal.reservedAt,
    completedAt: withdrawal.completedAt,
    rejectedAt: withdrawal.rejectedAt,
    rejectionReason: withdrawal.rejectionReason,
    externalReference: withdrawal.externalReference,
    createdAt: withdrawal.createdAt,
  };
}

function withdrawalIdFromPath(ctx: MockRequestContext): string | undefined {
  return /\/withdrawals\/([^/]+)$/.exec(ctx.url)?.[1];
}

function payoutAccountIdFromPath(ctx: MockRequestContext): string | undefined {
  return /\/payout-accounts\/([^/]+)$/.exec(ctx.url)?.[1];
}

function saleIdFromPath(ctx: MockRequestContext): string | undefined {
  const match = /\/sales\/([^/]+)\/resubmit$/.exec(ctx.url);
  if (match) return match[1];
  const reopen = /\/sales\/([^/]+)\/reopen-request$/.exec(ctx.url);
  if (reopen) return reopen[1];
  const detail = /\/sales\/([^/]+)$/.exec(ctx.url);
  return detail ? detail[1] : undefined;
}

function memberIdFromPath(ctx: MockRequestContext): string | undefined {
  const match = /\/members\/([^/]+)$/.exec(ctx.url);
  return match ? match[1] : undefined;
}

function voucherIdFromPath(ctx: MockRequestContext): string | undefined {
  const match = /\/vouchers\/([^/]+)$/.exec(ctx.url);
  return match ? match[1] : undefined;
}

/** F2-B: direct referral projection (single-level - BR-REF-001/002). */
function toDirectReferral(member: MockMember): DirectReferral {
  return {
    id: member.id,
    name: `${member.firstName} ${member.lastName}`,
    status: member.status,
    isQualified: member.isQualified,
    joinedAt: member.registeredAt,
  };
}

/** F2-B: recursive genealogy tree - visualization only, never commission (BI-004). */
function buildGenealogyNode(store: MockStore, member: MockMember): GenealogyNode {
  const children = store.members
    .filter((candidate) => candidate.sponsorId === member.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((child) => buildGenealogyNode(store, child));
  return {
    id: member.id,
    name: `${member.firstName} ${member.lastName}`,
    status: member.status,
    isQualified: member.isQualified,
    joinedAt: member.registeredAt,
    children,
  };
}

/** F2-B: upline chain - topmost reachable ancestor → direct sponsor (cycle-guarded). */
function buildAncestorChain(store: MockStore, member: MockMember): GenealogyNode[] {
  const chain: GenealogyNode[] = [];
  const visited = new Set<string>([member.id]);
  let currentId: string | null = member.sponsorId ?? null;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = store.members.find((candidate) => candidate.id === currentId);
    if (!parent) break;
    chain.unshift({
      id: parent.id,
      name: `${parent.firstName} ${parent.lastName}`,
      status: parent.status,
      isQualified: parent.isQualified,
      joinedAt: parent.registeredAt,
      children: [],
    });
    currentId = parent.sponsorId ?? null;
  }
  return chain;
}

/** F2-B: descendant set of a member (the member's network, reporting only - BR-RPT-002). */
function networkDescendants(store: MockStore, memberId: string): MockMember[] {
  const result: MockMember[] = [];
  const visit = (parentId: string) => {
    for (const candidate of store.members) {
      if (candidate.sponsorId === parentId) {
        result.push(candidate);
        visit(candidate.id);
      }
    }
  };
  visit(memberId);
  return result;
}

/** F2-B: network summary - reporting concept only, no MLM implication (BI-004). */
function toGroupNetwork(store: MockStore, member: MockMember): GroupNetwork {
  const descendants = networkDescendants(store, member.id);
  return {
    totalMembers: descendants.length,
    directReferrals: descendants.filter((candidate) => candidate.sponsorId === member.id).length,
    qualified: descendants.filter((candidate) => candidate.isQualified).length,
    pending: descendants.filter((candidate) => candidate.status === 'PENDING').length,
    rejected: descendants.filter((candidate) => candidate.status === 'REJECTED').length,
  };
}

/** F2-B: voucher projection - values are server-authoritative exact-decimal strings. */
function toVoucher(voucher: MockVoucher): Voucher {
  return {
    id: voucher.id,
    code: voucher.code,
    title: voucher.title,
    originalValue: voucher.originalValue,
    remainingValue: voucher.remainingValue,
    status: voucher.status,
    createdAt: voucher.createdAt,
    expiresAt: voucher.expiresAt,
    redeemedAt: voucher.redeemedAt,
    redeemedBy: voucher.redeemedBy,
  };
}

/** F1 member/auth mock API (API-shaped). Replaced by the real backend. */
export function memberMockHandlers(store: MockStore): MockRoute[] {
  const makeVerificationCode = (): string => String(Math.floor(100000 + Math.random() * 900000));

  const autoReferralCode = (lastName: string): string => {
    const base = `JAD-${lastName.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
    let code = base;
    let n = 2;
    while (store.members.some((candidate) => candidate.referralCode === code)) {
      code = `${base}${n}`;
      n += 1;
    }
    return code;
  };

  return [
    // ---- PUBLIC: auth ------------------------------------------------
    {
      path: '/auth/login',
      method: 'POST',
      handler: (ctx) => {
        const parsed = loginRequestSchema.safeParse(ctx.body);
        if (!parsed.success)
          return error(
            'VALIDATION_ERROR',
            'Enter your email address or phone number and password.',
            400,
          );
        const { identifier, password } = parsed.data;
        const trimmed = identifier.trim().toLowerCase();
        // Dev placeholder alias: allow the placeholder credentials shown in the UI
        // (username@gmail.com / Password) to sign in as the demo member. This keeps
        // the placeholder example usable without exposing a new account.
        if (trimmed === 'username@gmail.com' && password === 'Password') {
          const aliasMember = store.members.find(
            (candidate) => candidate.email.toLowerCase() === 'juan.delacruz@example.com',
          );
          if (aliasMember) {
            if (aliasMember.archivedAt) {
              return error('ACCOUNT_ARCHIVED', ARCHIVED_ACCOUNT_MESSAGE, 403);
            }
            if (aliasMember.accountStatus === 'INACTIVE') {
              return error('ACCOUNT_INACTIVE', INACTIVE_ACCOUNT_MESSAGE, 403);
            }
            return ok({ user: toSessionUser(aliasMember) });
          }
        }
        // Single SUPER_ADMIN seed: superadmin@gmail.com / P@ssword (single admin type).
        if (trimmed === 'superadmin@gmail.com' && password === 'P@ssword') {
          return ok({
            user: {
              id: MOCK_SUPER_ADMIN.id,
              name: MOCK_SUPER_ADMIN.name,
              email: MOCK_SUPER_ADMIN.email,
              role: MOCK_SUPER_ADMIN.role,
              isQualified: true,
              status: 'APPROVED_ACTIVE',
            },
          });
        }
        const member = store.members.find(
          (candidate) =>
            candidate.email.toLowerCase() === trimmed || candidate.phone === identifier.trim(),
        );
        if (!member || member.passwordHash !== hashPassword(password)) {
          return error('UNAUTHORIZED', 'Email or password is incorrect.', 401);
        }
        // Mirror the live login gates: archived/inactive members cannot sign in.
        if (member.archivedAt) {
          return error('ACCOUNT_ARCHIVED', ARCHIVED_ACCOUNT_MESSAGE, 403);
        }
        if (member.accountStatus === 'INACTIVE') {
          return error('ACCOUNT_INACTIVE', INACTIVE_ACCOUNT_MESSAGE, 403);
        }
        return ok({ user: toSessionUser(member) });
      },
    },
    {
      path: '/auth/register',
      method: 'POST',
      handler: (ctx) => {
        const parsed = registerRequestSchema.safeParse(ctx.body);
        if (!parsed.success) {
          return error(
            'VALIDATION_ERROR',
            'Some registration details are missing or invalid.',
            400,
            parsed.error.issues,
          );
        }
        const input = parsed.data;
        const email = input.email.trim().toLowerCase();
        if (store.members.some((candidate) => candidate.email.toLowerCase() === email)) {
          return validationError('An account with this email address already exists.');
        }
        if (input.referralCode) {
          const sponsor = store.members.find(
            (candidate) =>
              candidate.referralCode.toLowerCase() === input.referralCode!.trim().toLowerCase(),
          );
          if (!sponsor || !sponsor.isQualified) {
            return validationError('The referral code is not valid.');
          }
        }
        const age = ageFromDateOfBirth(input.dateOfBirth);
        if (age < store.minAge) {
          return validationError(`Applicants must be at least ${store.minAge} years old.`);
        }
        const country = store.countries.find((candidate) => candidate.code === input.countryCode);
        if (!country) return validationError('Select a valid country.');
        const program = store.programs.find((candidate) => candidate.id === input.programId);
        if (!program) return validationError('Select a valid program.');

        const nextId = `mem-${String(store.members.length + 1).padStart(3, '0')}`;
        const member: MockMember = {
          id: nextId,
          firstName: input.firstName,
          lastName: input.lastName,
          middleInitial: input.middleInitial,
          nameSuffix: input.nameSuffix,
          dateOfBirth: input.dateOfBirth,
          age,
          gender: input.gender,
          address: input.address,
          provinceCode: input.provinceCode,
          cityCode: input.cityCode,
          barangayCode: input.barangayCode,
          region: input.region,
          city: input.city,
          countryCode: country.code,
          countryName: country.name,
          phone: input.phone,
          email,
          passwordHash: hashPassword(input.password),
          referralCode: autoReferralCode(input.lastName),
          sponsorId: input.referralCode
            ? store.members.find(
                (candidate) =>
                  candidate.referralCode.toLowerCase() === input.referralCode!.trim().toLowerCase(),
              )?.id
            : undefined,
          status: 'PENDING',
          isQualified: false,
          isEmailVerified: false,
          isIdVerified: false,
          adminApproved: false,
          qualificationMet: false,
          programId: input.programId,
          verificationCode: makeVerificationCode(),
          qualificationAnswers: input.qualificationAnswers,
          idDocument: input.idDocument,
          registeredAt: new Date().toISOString(),
        };
        store.members.push(member);
        return created({ application: toApplication(member) });
      },
    },
    {
      path: '/auth/verify-email',
      method: 'POST',
      handler: (ctx) => {
        const parsed = verifyEmailRequestSchema.safeParse(ctx.body);
        if (!parsed.success)
          return validationError('Enter your email address and the verification code.');
        const { email, code } = parsed.data;
        const member = store.members.find(
          (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
        );
        if (!member) return error('NOT_FOUND', 'No application found for this email address.', 404);
        if (!member.verificationCode || member.verificationCode !== code.trim()) {
          return validationError('The verification code is incorrect or has expired.');
        }
        member.isEmailVerified = true;
        member.verificationCode = undefined;
        return ok({ email: member.email, verifiedAt: new Date().toISOString() });
      },
    },
    {
      path: '/auth/verify-email/resend',
      method: 'POST',
      handler: (ctx) => {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== 'string' || !email)
          return validationError('Enter your email address.');
        const member = store.members.find(
          (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
        );
        if (!member) return error('NOT_FOUND', 'No application found for this email address.', 404);
        return ok({ email: member.email, devOnlyCode: member.verificationCode ?? undefined });
      },
    },

    // ---- AUTH (member) ------------------------------------------------
    {
      path: '/me/resubmit',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        if (member.status !== 'REJECTED') {
          return error('CONFLICT', 'Only a rejected application can be resubmitted.', 409);
        }
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (body.countryCode !== undefined && body.countryCode !== member.countryCode) {
          return validationError('Country cannot be changed.');
        }
        if (typeof body.firstName === 'string' && body.firstName.trim())
          member.firstName = body.firstName.trim();
        if (typeof body.lastName === 'string' && body.lastName.trim())
          member.lastName = body.lastName.trim();
        if (typeof body.middleInitial === 'string') member.middleInitial = body.middleInitial;
        if (typeof body.nameSuffix === 'string') member.nameSuffix = body.nameSuffix;
        if (typeof body.phone === 'string' && body.phone.trim()) member.phone = body.phone.trim();
        if (typeof body.address === 'string') member.address = body.address;
        if (typeof body.dateOfBirth === 'string' && body.dateOfBirth) {
          const age = ageFromDateOfBirth(body.dateOfBirth);
          if (age < store.minAge)
            return validationError(`Applicants must be at least ${store.minAge} years old.`);
          member.dateOfBirth = body.dateOfBirth;
          member.age = age;
        }
        if (typeof body.gender === 'string' && body.gender.trim())
          member.gender = body.gender.trim();
        if (Array.isArray(body.qualificationAnswers))
          member.qualificationAnswers = body.qualificationAnswers;
        if (typeof body.idDocument === 'object' && body.idDocument !== null) {
          member.idDocument = body.idDocument as MockMember['idDocument'];
        }
        member.status = 'PENDING';
        member.isQualified = false;
        member.isIdVerified = false;
        member.adminApproved = false;
        member.qualificationMet = false;
        member.rejectionReason = undefined;
        return ok({ application: toApplication(member) });
      },
    },

    // ---- PUBLIC: config / programs / catalog --------------------------
    {
      path: '/config/public',
      method: 'GET',
      handler: () =>
        ok({
          minimumAge: store.minAge,
          genders: store.genders,
          countries: store.countries,
          withdrawalLimits: store.withdrawalLimits,
        }),
    },
    {
      path: '/registration/location-verify',
      method: 'POST',
      handler: (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const hasGps = typeof body.latitude === 'number' && typeof body.longitude === 'number';
        // Isolated mapping: PH → DOMESTIC, non-PH → ABROAD
        const mapCountryToProgram = (cc: string): { programId: string; programCode: string } => {
          const code = cc.toUpperCase();
          if (code === 'PH') return { programId: 'prg-domestic', programCode: 'DOMESTIC' };
          return { programId: 'prg-abroad', programCode: 'ABROAD' };
        };
        const makeId = () => {
          try {
            const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
            const fn = g?.crypto?.randomUUID;
            if (fn) return fn.call((globalThis as unknown as { crypto: unknown }).crypto);
          } catch {}
          // Fallback valid uuid (not PH-dependent) for jsdom without crypto
          return (
            '550e8400-e29b-41d4-a716-44665544' +
            String(Math.floor(Math.random() * 10000)).padStart(4, '0')
          );
        };
        // DEV ONLY: Mock emulates the API contract, not the geolocation algorithm.
        // Do NOT add fixture coordinate mappings or bounding boxes here.
        // Production GPS → Nominatim → ISO country is exercised via the real handler
        // (api/v1/registration/location-verify.ts) through Vite proxy → localhost:3000.
        // This mock is fallback for isolated frontend tests (Vitest) where the dev server is not running.
        // To simulate a specific country in dev/tests, set VITE_DEV_LOCATION_COUNTRY (e.g. JP) or
        // pass { devCountryCode: 'JP' } in the request body, or set localStorage 'jad:dev:country'.
        // Example: VITE_DEV_LOCATION_COUNTRY=JP pnpm --filter @jad/web dev
        const resolveDevCountry = (): string | null => {
          // 1) explicit body override (test convenience, DEV ONLY)
          const bodyDev = (body as { devCountryCode?: unknown }).devCountryCode;
          if (typeof bodyDev === 'string' && /^[A-Za-z]{2}$/.test(bodyDev.trim())) {
            return bodyDev.trim().toUpperCase();
          }
          // 2) Vite env var - VITE_DEV_LOCATION_COUNTRY (DEV ONLY)
          try {
            const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
            const envVal = viteEnv?.VITE_DEV_LOCATION_COUNTRY ?? viteEnv?.DEV_LOCATION_COUNTRY;
            if (typeof envVal === 'string' && /^[A-Za-z]{2}$/.test(envVal.trim()))
              return envVal.trim().toUpperCase();
          } catch {}
          // 3) localStorage override for runtime switching in browser dev
          try {
            const ls =
              typeof localStorage !== 'undefined' ? localStorage.getItem('jad:dev:country') : null;
            if (typeof ls === 'string' && /^[A-Za-z]{2}$/.test(ls.trim()))
              return ls.trim().toUpperCase();
          } catch {}
          return null;
        };

        if (hasGps) {
          const lat = body.latitude as number;
          const lon = body.longitude as number;
          if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            return error('VALIDATION_ERROR', 'Invalid coordinates', 400);
          }
          // No coordinate → country inference here. Use explicit dev country selection.
          // If no dev override is set, default to PH for local dev convenience (still via contract, not via bbox).
          // To test other countries, set VITE_DEV_LOCATION_COUNTRY=JP (or AE/SG/US) and reload.
          const devCc = resolveDevCountry();
          const cc = devCc ?? 'PH';
          // Emulate backend validation: any 2-letter code is accepted for contract; backend will validate against DB master.
          // Do NOT maintain a hard-coded fixture list here.
          if (!/^[A-Z]{2}$/.test(cc)) {
            return error('GEO_REVERSE_FAILED', `Invalid country code from dev mock: ${cc}`, 422);
          }
          const { programId, programCode } = mapCountryToProgram(cc);
          return ok({
            verificationId: makeId(),
            verifiedCountryCode: cc,
            detectedCountryCode: cc,
            programId,
            programCode,
            method: 'GPS',
            isPhilippines: cc === 'PH',
            blocked: false,
            requiresException: false,
            accuracy: typeof body.accuracy === 'number' ? body.accuracy : undefined,
          });
        }
        // IP fallback - use ONLY existing Vercel header, never PH default
        const raw = (ctx.header('x-vercel-ip-country') ?? '').trim().toUpperCase();
        if (raw && /^[A-Z]{2}$/.test(raw)) {
          const { programId, programCode } = mapCountryToProgram(raw);
          return ok({
            verificationId: makeId(),
            verifiedCountryCode: raw,
            detectedCountryCode: raw,
            programId,
            programCode,
            method: 'IP',
            isPhilippines: raw === 'PH',
            blocked: false,
            requiresException: false,
          });
        }
        return error(
          'GEO_UNAVAILABLE',
          'Location could not be determined. Please enable location access and retry.',
          422,
        );
      },
    },
    {
      path: '/programs',
      method: 'GET',
      handler: () => list(store.programs),
    },
    {
      // Philippine location reference (tiny dev dataset mirroring the
      // PSGC-seeded tables; the form pages through these, never bundles them).
      path: '/locations/provinces',
      method: 'GET',
      handler: () =>
        list([
          { code: '0128', name: 'Ilocos Norte', kind: 'province' },
          { code: '133900', name: 'City of Manila', kind: 'city' },
        ]),
    },
    {
      path: '/locations/cities',
      method: 'GET',
      handler: (ctx) => {
        const provinceCode = new URL(ctx.url, 'http://mock.local').searchParams.get(
          'provinceCode',
        );
        if (provinceCode === '0128') {
          return list([
            { code: '012801', name: 'Laoag City', provinceCode: '0128', kind: 'city' },
            { code: '012802', name: 'Adams', provinceCode: '0128', kind: 'municipality' },
          ]);
        }
        return list([]);
      },
    },
    {
      path: '/locations/barangays',
      method: 'GET',
      handler: (ctx) => {
        const cityCode = new URL(ctx.url, 'http://mock.local').searchParams.get('cityCode');
        if (cityCode === '012801') {
          return list([
            { code: '012801001', name: 'Brgy 1', cityCode: '012801' },
            { code: '012801002', name: 'Brgy 2', cityCode: '012801' },
          ]);
        }
        if (cityCode === '133900') {
          return list([{ code: '133900001', name: 'Brgy 2', cityCode: '133900' }]);
        }
        return list([]);
      },
    },
    {
      path: '/programs',
      method: 'GET',
      match: 'prefix',
      handler: (ctx) => {
        const match = /\/programs\/([^/]+)\/qualification-questions$/.exec(ctx.url);
        if (!match) return error('NOT_FOUND', 'Not found', 404);
        return list(store.qualificationQuestions);
      },
    },
    {
      path: '/properties',
      method: 'GET',
      handler: () => list(store.properties),
    },

    // ---- MEMBER: own resources (object-level, NFR-AUTHZ-002) ----------
    {
      path: '/members/',
      method: 'GET',
      match: 'prefix',
      handler: (ctx) => {
        const id = memberIdFromPath(ctx);
        if (!id) return error('NOT_FOUND', 'Not found', 404);
        const member = store.members.find((candidate) => candidate.id === id);
        if (!member || mockSessionRef.current?.id !== member.id) {
          return error('NOT_FOUND', 'Not found', 404);
        }
        return ok(toProfile(member, store));
      },
    },
    {
      path: '/me',
      method: 'PATCH',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        if (body.countryCode !== undefined && body.countryCode !== member.countryCode) {
          return validationError('Country cannot be changed.');
        }
        if (typeof body.firstName === 'string' && body.firstName.trim())
          member.firstName = body.firstName.trim();
        if (typeof body.lastName === 'string' && body.lastName.trim())
          member.lastName = body.lastName.trim();
        if (typeof body.middleInitial === 'string') member.middleInitial = body.middleInitial;
        if (typeof body.nameSuffix === 'string') member.nameSuffix = body.nameSuffix;
        if (typeof body.gender === 'string' && body.gender.trim())
          member.gender = body.gender.trim();
        if (typeof body.address === 'string') member.address = body.address;
        if (typeof body.phone === 'string' && body.phone.trim()) member.phone = body.phone.trim();
        return ok(toProfile(member, store));
      },
    },
    {
      path: '/me/wallet',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const wallet = store.wallets[member.id];
        if (wallet) return ok(wallet);
        return ok({
          availableBalance: '0.00',
          pendingAmount: '0.00',
          pendingCommission: '0.00',
          totalWithdrawals: '0.00',
          totalEarned: '0.00',
        });
      },
    },
    {
      path: '/me/ledger',
      method: 'GET',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const url = new URL(ctx.url, 'http://mock.local');
        const cursor = url.searchParams.get('cursor') ?? undefined;
        const typeFilter = url.searchParams.get('type') ?? undefined;
        const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit =
          Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 100)
            : 50;

        // Append-only ledger: stable order by id asc (cursor key, API-SPECIFICATION §4).
        const ordered = store.ledger
          .filter((entry) => entry.memberId === member.id)
          .sort((a, b) => a.id.localeCompare(b.id));

        // Filter by type/status - allowlisted keys only (SCR-MEM-009).
        const allowedTypes = [
          'DIRECT_COMMISSION',
          'DIRECT_REFERRAL',
          'GROUP_INCENTIVE',
          'WITHDRAWAL',
          'WITHDRAWAL_RESERVATION',
          'WITHDRAWAL_COMPLETION',
          'WITHDRAWAL_REVERSAL',
          'COMMISSION_REVERSAL',
          'FINANCIAL_ADJUSTMENT',
        ];

        // Server-computed running Available Balance per entry (SCR-MEM-009).
        // A WITHDRAWAL_COMPLETION finalizes an already-reserved deduction
        // (BR-WDR-003) and therefore does not change the running balance.
        let balance = '0.00';
        const withBalance = ordered.map((entry) => {
          if (entry.entryType !== 'WITHDRAWAL_COMPLETION') {
            balance =
              entry.direction === 'CREDIT'
                ? addMoney(balance, entry.amount)
                : subtractMoney(balance, entry.amount);
          }
          return {
            id: entry.id,
            entryType: entry.entryType,
            direction: entry.direction,
            amount: entry.amount,
            createdAt: entry.createdAt,
            balanceAfter: balance,
          };
        });

        // Apply the allowlisted type filter AFTER balance computation - running
        // balance is computed over the full append-only ledger, then filtered.
        if (typeFilter) {
          if (!allowedTypes.includes(typeFilter)) {
            return validationError('Unknown ledger entry type filter.');
          }
          const filtered = withBalance.filter((entry) => entry.entryType === typeFilter);
          const startIndex = cursor ? filtered.findIndex((entry) => entry.id === cursor) + 1 : 0;
          const page = filtered.slice(startIndex, startIndex + limit);
          const hasMore = startIndex + limit < filtered.length;
          const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
          return ok({
            data: page,
            meta: { pagination: { nextCursor } },
          });
        }

        const startIndex = cursor ? withBalance.findIndex((entry) => entry.id === cursor) + 1 : 0;
        const page = withBalance.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < withBalance.length;
        const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
        return ok({
          data: page,
          meta: { pagination: { nextCursor } },
        });
      },
    },
    {
      path: '/me/qualification',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const requirements = [
          {
            key: 'MIN_AGE',
            label: 'Minimum age',
            met: member.age >= store.minAge,
            detail:
              member.age >= store.minAge
                ? undefined
                : `Applicants must be at least ${store.minAge} years old.`,
          },
          {
            key: 'EMAIL_VERIFIED',
            label: 'Email verified',
            met: member.isEmailVerified,
            detail: member.isEmailVerified ? undefined : 'Verify your email address to continue.',
          },
          {
            key: 'ID_VERIFIED',
            label: 'Government ID verified',
            met: member.isIdVerified,
            detail: member.isIdVerified
              ? undefined
              : 'Your government-issued ID is verified manually by JA&D Admin.',
          },
          {
            key: 'ADMIN_APPROVAL',
            label: 'Admin approval',
            met: member.adminApproved,
            detail: member.adminApproved
              ? undefined
              : 'Your application is under review by JA&D Admin.',
          },
          {
            key: 'QUALIFICATION',
            label: 'Qualification requirements satisfied',
            met: member.qualificationMet,
            detail: member.qualificationMet
              ? undefined
              : 'Complete the qualification questions to satisfy the qualification requirements.',
          },
        ];
        return ok({
          status: member.status,
          isQualified: member.isQualified,
          requirements,
          rejectionReason: member.rejectionReason,
        });
      },
    },
    {
      path: '/me/referral-code',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        return ok({ code: member.referralCode });
      },
    },
    {
      path: '/me/broadcasts',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        // Own rows + broadcasts (memberId null), newest first - mirrors the
        // real endpoint (member_id.is.null OR member_id.eq.<uid>).
        const items = store.notifications
          .filter(
            (notification) => notification.memberId === member.id || notification.memberId === null,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((notification) => ({
            id: notification.id,
            title: notification.title,
            body: notification.body,
            createdAt: notification.createdAt,
            readAt: notification.readAt,
          }));
        return list(items);
      },
    },
    {
      path: '/me/broadcasts/read-all',
      method: 'POST',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        let updated = 0;
        for (const notification of store.notifications) {
          if (
            (notification.memberId === member.id || notification.memberId === null) &&
            !notification.readAt
          ) {
            notification.readAt = new Date().toISOString();
            updated += 1;
          }
        }
        return ok({ updated });
      },
    },
    {
      path: '/me/broadcasts/',
      method: 'POST',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const match = /\/me\/broadcasts\/([^/]+)\/read$/.exec(ctx.url);
        if (!match) return error('NOT_FOUND', 'Not found', 404);
        const notification = store.notifications.find(
          (candidate) =>
            candidate.id === match[1] &&
            (candidate.memberId === member.id || candidate.memberId === null),
        );
        if (!notification) return error('NOT_FOUND', 'Notification not found', 404);
        if (!notification.readAt) notification.readAt = new Date().toISOString();
        return ok({ id: notification.id, readAt: notification.readAt });
      },
    },

    // ---- MEMBER: admin↔member messaging (FEAT-072, ADR-013) -------------
    {
      path: '/me/messages',
      method: 'GET',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const url = new URL(ctx.url, 'http://mock.local');
        const cursor = url.searchParams.get('cursor') ?? undefined;
        const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
        const limit =
          Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 100)
            : 50;
        const ordered = store.messages
          .filter((message) => message.memberId === member.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const startIndex = cursor ? ordered.findIndex((message) => message.id === cursor) + 1 : 0;
        const page = ordered.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < ordered.length;
        const nextCursor = hasMore ? page[page.length - 1]?.id : undefined;
        return ok({
          data: page.map((message) => ({
            id: message.id,
            senderType: message.senderType,
            senderName: message.senderName,
            body: message.body,
            createdAt: message.createdAt,
          })),
          meta: { pagination: nextCursor ? { nextCursor } : {} },
        });
      },
    },
    {
      path: '/me/messages',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const body = (ctx.body ?? {}) as { body?: unknown };
        if (typeof body.body !== 'string' || body.body.trim().length === 0) {
          return validationError('Enter a message.');
        }
        const trimmed = body.body.trim();
        if (trimmed.length > 4000) return validationError('Message is too long.');
        const message = {
          id: `msg-${String(store.nextMessageId++).padStart(3, '0')}`,
          memberId: member.id,
          senderType: 'MEMBER' as const,
          senderName: `${member.firstName} ${member.lastName}`,
          body: trimmed,
          createdAt: new Date().toISOString(),
        };
        store.messages.push(message);
        return created({
          id: message.id,
          senderType: message.senderType,
          senderName: message.senderName,
          body: message.body,
          createdAt: message.createdAt,
        });
      },
    },
    {
      path: '/me/messages/read',
      method: 'POST',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const readAt = new Date().toISOString();
        store.messageReads[member.id] = readAt;
        return ok({ readAt });
      },
    },
    {
      path: '/me/messages/summary',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const readAt = store.messageReads[member.id];
        const thread = store.messages
          .filter((message) => message.memberId === member.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const unreadCount = readAt
          ? thread.filter((message) => message.senderType === 'STAFF' && message.createdAt > readAt)
              .length
          : thread.filter((message) => message.senderType === 'STAFF').length;
        return ok({
          unreadCount,
          lastMessageAt: thread[0]?.createdAt,
        });
      },
    },

    // ---- MEMBER: referrals & reporting (FG-REF / FG-REPORTING) -----------
    {
      path: '/me/direct-referrals',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.members
          .filter((candidate) => candidate.sponsorId === member.id)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(toDirectReferral);
        return list(items);
      },
    },
    {
      path: '/me/reports/group-network',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        return ok(toGroupNetwork(store, member));
      },
    },
    {
      path: '/me/genealogy',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const ancestors = buildAncestorChain(store, member);
        return ok({
          root: buildGenealogyNode(store, member),
          sponsor: ancestors.length > 0 ? ancestors[ancestors.length - 1] : null,
          ancestors,
        });
      },
    },

    // ---- MEMBER: vouchers (FG-VOUCHER, own only) -------------------------
    {
      path: '/me/vouchers',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.vouchers
          .filter((voucher) => voucher.memberId === member.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(toVoucher);
        return list(items);
      },
    },
    {
      path: '/vouchers/',
      method: 'GET',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = voucherIdFromPath(ctx);
        const voucher = store.vouchers.find(
          (candidate) => candidate.id === id && candidate.memberId === member.id,
        );
        if (!voucher) return error('NOT_FOUND', 'Not found', 404);
        return ok(toVoucher(voucher));
      },
    },

    // ---- MEMBER/PUBLIC: content, policies (FG-CONTENT) -------------------
    {
      path: '/content/forwardable',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.contentItems
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            kind: item.kind,
            downloadUrl: item.downloadUrl,
            share: item.share,
            createdAt: item.createdAt,
          }));
        return list(items);
      },
    },
    {
      path: '/policies',
      method: 'GET',
      handler: () => list(store.policies),
    },

    // ---- MEMBER: finances (FG-COMMISSION / FG-EWALLET / FG-PAYOUT / FG-WDR) -----
    {
      path: '/me/commissions',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.commissions
          .filter((commission) => commission.memberId === member.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((commission) => toCommission(commission, store));
        return list(items);
      },
    },
    {
      path: '/me/payout-accounts',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.payoutAccounts
          .filter((account) => account.memberId === member.id)
          .map(toPayoutAccount);
        return list(items);
      },
    },
    {
      path: '/me/payout-accounts',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const parsed = createPayoutAccountRequestSchema.safeParse(ctx.body);
        if (!parsed.success) {
          return validationError('Enter the payout method, account name, and account identifier.');
        }
        const account: MockPayoutAccount = {
          id: `pa-${String(store.nextPayoutAccountId).padStart(3, '0')}`,
          memberId: member.id,
          method: parsed.data.method,
          accountName: parsed.data.accountName,
          accountIdentifier: parsed.data.accountIdentifier,
          status: 'PENDING',
          isPrimary: false,
          createdAt: new Date().toISOString(),
        };
        store.nextPayoutAccountId += 1;
        store.payoutAccounts.push(account);
        return created(toPayoutAccount(account));
      },
    },
    {
      path: '/me/payout-accounts/',
      method: 'PATCH',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = payoutAccountIdFromPath(ctx);
        const account = store.payoutAccounts.find(
          (candidate) => candidate.id === id && candidate.memberId === member.id,
        );
        if (!account) return error('NOT_FOUND', 'Not found', 404);
        if (account.status !== 'CONFIRMED') {
          return error(
            'VALIDATION_ERROR',
            'Only confirmed payout accounts can be set as primary.',
            422,
          );
        }
        const parsed = setPrimaryPayoutAccountRequestSchema.safeParse(ctx.body);
        if (!parsed.success) return validationError('Invalid request.');
        for (const candidate of store.payoutAccounts) {
          if (candidate.memberId === member.id) candidate.isPrimary = false;
        }
        account.isPrimary = true;
        return ok(toPayoutAccount(account));
      },
    },
    {
      path: '/me/payout-accounts/',
      method: 'DELETE',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = payoutAccountIdFromPath(ctx);
        const index = store.payoutAccounts.findIndex(
          (candidate) => candidate.id === id && candidate.memberId === member.id,
        );
        if (index === -1) return error('NOT_FOUND', 'Not found', 404);
        const account = store.payoutAccounts[index]!;
        if (account.status !== 'PENDING') {
          return error(
            'VALIDATION_ERROR',
            'Only pending payout accounts can be deleted. Contact support for other statuses.',
            422,
          );
        }
        if (account.isPrimary) {
          return error('VALIDATION_ERROR', 'Cannot delete the primary payout account.', 422);
        }
        store.payoutAccounts.splice(index, 1);
        return ok({ deleted: true });
      },
    },
    {
      path: '/me/withdrawals',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const key = ctx.header('idempotency-key');
        if (!key) {
          return error('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400);
        }
        const idempotencyPath = `POST:/me/withdrawals:${key}`;
        const stored = store.idempotency[idempotencyPath];
        if (stored) return ok(stored);

        const parsed = createWithdrawalRequestSchema.safeParse(ctx.body);
        if (!parsed.success) {
          return validationError('Enter an amount and choose a verified payout account.');
        }
        const { amount, payoutAccountId } = parsed.data;
        const account = store.payoutAccounts.find(
          (candidate) => candidate.id === payoutAccountId && candidate.memberId === member.id,
        );
        if (!account) return error('NOT_FOUND', 'Payout account not found.', 404);
        if (account.status !== 'CONFIRMED') {
          return error(
            'PAYOUT_ACCOUNT_UNVERIFIED',
            'Only verified payout accounts can be used for withdrawal.',
            422,
          );
        }
        if (compareMoney(amount, '0.00') <= 0) {
          return validationError('Enter a withdrawal amount greater than zero.');
        }
        // Configured minimum (mirrors withdraw_reserve's MIN guard).
        if (compareMoney(amount, store.withdrawalLimits.min) < 0) {
          return validationError(
            `The withdrawal amount is below the minimum of ${store.withdrawalLimits.min}.`,
          );
        }
        const wallet = store.wallets[member.id] ?? {
          availableBalance: '0.00',
          pendingAmount: '0.00',
        };
        if (compareMoney(amount, wallet.availableBalance) > 0) {
          return error(
            'INSUFFICIENT_BALANCE',
            'The withdrawal amount exceeds your Available Balance.',
            409,
          );
        }
        // Configured maximum, after the balance so over-balance requests keep
        // the INSUFFICIENT_BALANCE contract (mirrors withdraw_reserve).
        if (compareMoney(amount, store.withdrawalLimits.max) > 0) {
          return validationError(
            `The withdrawal amount exceeds the maximum of ${store.withdrawalLimits.max}.`,
          );
        }

        const now = new Date().toISOString();
        const withdrawal: MockWithdrawal = {
          id: `wdr-${String(store.nextWithdrawalId).padStart(3, '0')}`,
          memberId: member.id,
          payoutAccountId: account.id,
          amount,
          status: 'RESERVED',
          reservedAt: now,
          createdAt: now,
        };
        store.nextWithdrawalId += 1;
        store.withdrawals.push(withdrawal);

        // Reserve funds immediately - exact-decimal, never negative (BR-WDR-002, BI-001).
        wallet.availableBalance = subtractMoney(wallet.availableBalance, amount);
        store.ledger.push({
          id: `led-${String(store.nextLedgerId).padStart(3, '0')}`,
          memberId: member.id,
          entryType: 'WITHDRAWAL_RESERVATION',
          direction: 'DEBIT',
          amount,
          createdAt: now,
        });
        store.nextLedgerId += 1;

        const response = toWithdrawal(withdrawal, store);
        store.idempotency[idempotencyPath] = response;
        return created(response);
      },
    },
    {
      path: '/me/withdrawals',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.withdrawals
          .filter((withdrawal) => withdrawal.memberId === member.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((withdrawal) => toWithdrawal(withdrawal, store));
        return list(items);
      },
    },
    {
      path: '/me/withdrawals/',
      method: 'GET',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = withdrawalIdFromPath(ctx);
        const withdrawal = store.withdrawals.find(
          (candidate) => candidate.id === id && candidate.memberId === member.id,
        );
        if (!withdrawal) return error('NOT_FOUND', 'Not found', 404);
        return ok(toWithdrawal(withdrawal, store));
      },
    },

    // ---- CUSTOMERS (AQ) ----------------------------------------------
    {
      path: '/customers',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.customers.filter((customer) => customer.sellerId === member.id);
        return list(items);
      },
    },
    {
      path: '/customers',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        if (!member.isQualified)
          return error(
            'MEMBER_NOT_QUALIFIED',
            'Only Active + Qualified members can record sales.',
            422,
          );
        const parsed = createCustomerRequestSchema.safeParse(ctx.body);
        if (!parsed.success) return validationError('Enter the customer name and phone number.');
        const customer = {
          id: `cus-${String(store.nextCustomerId).padStart(3, '0')}`,
          sellerId: member.id,
          ...parsed.data,
        };
        store.nextCustomerId += 1;
        store.customers.push(customer);
        return created(customer);
      },
    },

    // ---- SALES (AQ own) ----------------------------------------------
    {
      path: '/sales',
      method: 'GET',
      handler: () => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const items = store.sales
          .filter((sale) => sale.sellerId === member.id)
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
          .map(toSale);
        return list(items);
      },
    },
    {
      path: '/sales/',
      method: 'GET',
      match: 'prefix',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = saleIdFromPath(ctx);
        const sale = store.sales.find(
          (candidate) => candidate.id === id && candidate.sellerId === member.id,
        );
        if (!sale) return error('NOT_FOUND', 'Not found', 404);
        // Configured rates for the estimate preview (mirrors GET /sales/:id).
        return ok({
          ...toSale(sale),
          commissionRates: { direct: '0.0800', referral: '0.0400' },
        });
      },
    },
    {
      path: '/sales',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        if (!member.isQualified)
          return error(
            'MEMBER_NOT_QUALIFIED',
            'Only Active + Qualified members can submit sales.',
            422,
          );
        if (!ctx.header('idempotency-key')) {
          return error('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400);
        }
        const key = ctx.header('idempotency-key')!;
        const idempotencyPath = `POST:/sales:${key}`;
        const stored = store.idempotency[idempotencyPath];
        if (stored) return ok(stored);
        const parsed = submitSaleRequestSchema.safeParse(ctx.body);
        if (!parsed.success)
          return validationError('Select a customer and a property from the catalog.');
        const { customerId, propertyId } = parsed.data;
        const customer = store.customers.find(
          (candidate) => candidate.id === customerId && candidate.sellerId === member.id,
        );
        if (!customer) return error('NOT_FOUND', 'Customer not found.', 404);
        const property = store.properties.find((candidate) => candidate.id === propertyId);
        if (!property) return validationError('This property is not available in the catalog.');
        if (property.status !== 'ACTIVE')
          return validationError('This property is not available in the catalog.');
        const price = (property as { price?: string }).price ?? property.value;
        if (!price || price === '0.00')
          return validationError('This property is not available in the catalog.');
        const referrerId = parsed.data.referrerId;
        let referrerName: string | undefined;
        if (referrerId !== undefined) {
          const refMember = store.members.find(
            (m) =>
              m.id === referrerId &&
              (m.sponsorId === member.id || m.id === member.sponsorId),
          );
          if (!refMember)
            return error(
              'VALIDATION_ERROR',
              'The selected referrer must be your sponsor or one of your direct referrals.',
              400,
            );
          referrerName = `${refMember.firstName} ${refMember.lastName}`;
        }
        const sale: MockSale = {
          id: `sal-${String(store.nextSaleId).padStart(3, '0')}`,
          sellerId: member.id,
          sellerName: `${member.firstName} ${member.lastName}`,
          status: 'SUBMITTED',
          propertyId: property.id,
          propertyName: property.name,
          propertyValue: price,
          customerId: customer.id,
          customerName: customer.fullName,
          resubmissionCount: 0,
          submittedAt: new Date().toISOString(),
          ...(referrerId !== undefined ? { referrerId } : {}),
          ...(referrerName !== undefined ? { referrerName } : {}),
        };
        store.nextSaleId += 1;
        store.sales.push(sale);
        const saleResponse = toSale(sale);
        store.idempotency[idempotencyPath] = saleResponse;
        return created(saleResponse);
      },
    },
    {
      path: '/resubmit',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        if (!member.isQualified)
          return error(
            'MEMBER_NOT_QUALIFIED',
            'Only Active + Qualified members can submit sales.',
            422,
          );
        const id = saleIdFromPath(ctx);
        const sale = store.sales.find(
          (candidate) => candidate.id === id && candidate.sellerId === member.id,
        );
        if (!sale) return error('NOT_FOUND', 'Not found', 404);
        if (sale.status !== 'REJECTED') {
          return error('CONFLICT', 'Only a rejected sale can be resubmitted.', 409);
        }
        if (sale.resubmissionCount >= MAX_SALE_RESUBMISSIONS) {
          return error(
            'SALE_LOCKED',
            'This sale has reached the maximum resubmission attempts and is locked.',
            409,
            {
              maxAttempts: MAX_SALE_RESUBMISSIONS,
            },
          );
        }
        const parsed = submitSaleRequestSchema.safeParse(ctx.body);
        if (!parsed.success)
          return validationError('Select a customer and a property from the catalog.');
        const customer = store.customers.find(
          (candidate) =>
            candidate.id === parsed.data.customerId && candidate.sellerId === member.id,
        );
        if (!customer) return error('NOT_FOUND', 'Customer not found.', 404);
        const property = store.properties.find(
          (candidate) => candidate.id === parsed.data.propertyId,
        );
        if (!property) return validationError('This property is not available in the catalog.');
        if (property.status !== 'ACTIVE')
          return validationError('This property is not available in the catalog.');
        const price = (property as { price?: string }).price ?? property.value;
        if (!price || price === '0.00')
          return validationError('This property is not available in the catalog.');
        sale.customerId = customer.id;
        sale.customerName = customer.fullName;
        sale.propertyId = property.id;
        sale.propertyName = property.name;
        sale.propertyValue = price;
        if (parsed.data.referrerId !== undefined) {
          const refM = store.members.find(
            (m) =>
              m.id === parsed.data.referrerId &&
              (m.sponsorId === member.id || m.id === member.sponsorId),
          );
          if (!refM)
            return error(
              'VALIDATION_ERROR',
              'The selected referrer must be your sponsor or one of your direct referrals.',
              400,
            );
          sale.referrerId = refM.id;
          sale.referrerName = `${refM.firstName} ${refM.lastName}`;
        } else {
          sale.referrerId = undefined;
          sale.referrerName = undefined;
        }
        sale.resubmissionCount += 1;
        sale.status = 'SUBMITTED' as SaleStatus;
        sale.rejectionReason = undefined;
        sale.submittedAt = new Date().toISOString();
        return ok(toSale(sale));
      },
    },
    {
      path: '/reopen-request',
      method: 'POST',
      handler: (ctx) => {
        const member = currentMember(store);
        if (!member) return unauthorized();
        const id = saleIdFromPath(ctx);
        const sale = store.sales.find(
          (candidate) => candidate.id === id && candidate.sellerId === member.id,
        );
        if (!sale) return error('NOT_FOUND', 'Not found', 404);
        if (sale.status !== 'LOCKED') {
          return error('CONFLICT', 'Only a locked sale can be reopened by request.', 409);
        }
        return ok({ saleId: sale.id, requested: true });
      },
    },
  ];
}
