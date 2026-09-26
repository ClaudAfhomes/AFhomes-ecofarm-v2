import type {
  CommissionStatus,
  CommissionType,
  LedgerEntryType,
  MemberStatus,
  PayoutAccountStatus,
  PayoutMethod,
  Program,
  SaleStatus,
  WithdrawalStatus,
} from '@jad/contracts';
import { MOCK_MARKETING_CONTENT } from '@jad/mock';

/**
 * F1 member/API mock store - the in-memory "backend" behind the dev mock
 * server. Stands in for `apps/api` (not built yet); replaced entirely when the
 * real API lands. All identities are fictional (no real PII).
 *
 * The property seed mirrors the PUBLIC catalog content (`features/public/
 * content/properties.ts`) so the member sales feature and the marketing site
 * share ONE property source (CMS/content reuse - never a second catalog).
 * Only fixed-price units are submittable (eligible properties per program are
 * OD-003-gated; the mock offers the fixed-value catalog units).
 *
 * The F2-A financial seed is internally coherent: Available Balance equals the
 * ledger-derived balance (server-authoritative, BI-001/BI-002), Pending
 * commissions are excluded from Available, withdrawal reservations deduct and
 * rejections restore. None of the money arithmetic uses floats (exact-decimal
 * BigInt cents from `@jad/shared`).
 */

/** Mock-only password hash (FNV-1a). The real API uses Argon2/bcrypt; this is dev plumbing, never a security boundary. */
export function hashPassword(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Demo credential shared by all seeded mock member accounts (dev only). */
export const DEMO_PASSWORD = 'password123';

export interface MockMember {
  id: string;
  firstName: string;
  lastName: string;
  middleInitial?: string;
  nameSuffix?: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  address?: string;
  provinceCode?: string;
  cityCode?: string;
  barangayCode?: string;
  region?: string;
  city?: string;
  countryCode: string;
  countryName: string;
  phone: string;
  email: string;
  passwordHash: string;
  referralCode: string;
  sponsorId?: string;
  status: MemberStatus;
  accountStatus?: 'ACTIVE' | 'INACTIVE';
  archivedAt?: string | null;
  isQualified: boolean;
  isEmailVerified: boolean;
  isIdVerified: boolean;
  adminApproved: boolean;
  qualificationMet: boolean;
  programId: string;
  rejectionReason?: string;
  verificationCode?: string;
  qualificationAnswers?: { questionId: string; answer: string }[];
  idDocument?: { fileName: string; mimeType: string; sizeBytes: number };
  registeredAt: string;
}

export interface MockProperty {
  id: string;
  name: string;
  /** Transactional price - exact-decimal string; optional when no published price (CMS price). */
  price?: string;
  /** Legacy alias for price - keep for handler compatibility (same value as price when defined). */
  value: string;
  categoryId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MockCustomer {
  id: string;
  sellerId: string;
  fullName: string;
  phone: string;
  email?: string;
}

export interface MockSale {
  id: string;
  sellerId: string;
  sellerName: string;
  status: SaleStatus;
  propertyId: string;
  propertyName: string;
  propertyValue: string;
  customerId: string;
  customerName: string;
  resubmissionCount: number;
  rejectionReason?: string;
  submittedAt: string;
  approvedAt?: string;
  paymentVerifiedAt?: string;
  lockedAt?: string;
  referrerId?: string;
  /** Snapshot of the member who referred this customer (members only). */
  referrerName?: string;
}

export interface MockLedgerEntry {
  id: string;
  memberId: string;
  entryType: LedgerEntryType;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  createdAt: string;
}

export interface MockWallet {
  availableBalance: string;
  pendingAmount: string;
  pendingCommission?: string;
  totalWithdrawals?: string;
  totalEarned?: string;
}

export interface MockCommission {
  id: string;
  memberId: string;
  commissionType: CommissionType;
  saleId: string;
  baseValue: string;
  rate: string;
  amount: string;
  status: CommissionStatus;
  clearedAt?: string;
  cancelledAt?: string;
  reversedAt?: string;
  createdAt: string;
}

export interface MockPayoutAccount {
  id: string;
  memberId: string;
  method: PayoutMethod;
  accountName: string;
  /** SENSITIVE - only the masked form is ever returned to the client (DATABASE-DESIGN §8.3). */
  accountIdentifier: string;
  status: PayoutAccountStatus;
  isPrimary: boolean;
  createdAt: string;
  rejectionReason?: string;
}

export interface MockWithdrawal {
  id: string;
  memberId: string;
  payoutAccountId: string;
  amount: string;
  status: WithdrawalStatus;
  reservedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  externalReference?: string;
  createdAt: string;
}

/** Server-side mask of a payout account identifier (SECURITY.md - sensitive on read). */
export function maskIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (trimmed.length <= 4) return '\u2022\u2022\u2022\u2022';
  return `\u2022\u2022\u2022\u2022 ${trimmed.slice(-4)}`;
}

export interface MockNotification {
  id: string;
  /** Member-scoped row owner; `null` = broadcast to every member. */
  memberId: string | null;
  title: string;
  body?: string;
  createdAt: string;
  readAt?: string;
}

/** One chat message in a member's admin thread (ADR-013, FEAT-072). */
export interface MockMessage {
  id: string;
  memberId: string;
  senderType: 'MEMBER' | 'STAFF';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface MockVoucher {
  id: string;
  code: string;
  memberId: string;
  title: string;
  originalValue: string;
  remainingValue: string;
  status: 'ACTIVE' | 'FULLY_REDEEMED';
  createdAt: string;
  expiresAt?: string;
  redeemedAt?: string;
  redeemedBy?: string;
}

export interface MockContentItem {
  id: string;
  title: string;
  description?: string;
  kind: 'DOCUMENT' | 'IMAGE' | 'VIDEO' | 'PROMO';
  downloadUrl?: string;
  share?: {
    messengerUrl?: string;
    viberUrl?: string;
    copyUrl?: string;
  };
  createdAt: string;
}

export interface MockPolicy {
  id: string;
  slug: string;
  title: string;
  type: string;
  content?: string;
  documentUrl?: string;
  updatedAt: string;
}

export interface MockStore {
  minAge: number;
  genders: string[];
  withdrawalLimits: { min: string; max: string };
  countries: {
    code: string;
    name: string;
    dialCode?: string;
    phoneMin?: number;
    phoneMax?: number;
    phonePattern?: string;
  }[];
  programs: Program[];
  qualificationQuestions: { id: string; questionText: string }[];
  members: MockMember[];
  properties: MockProperty[];
  customers: MockCustomer[];
  sales: MockSale[];
  wallets: Record<string, MockWallet>;
  ledger: MockLedgerEntry[];
  commissions: MockCommission[];
  payoutAccounts: MockPayoutAccount[];
  withdrawals: MockWithdrawal[];
  notifications: MockNotification[];
  messages: MockMessage[];
  /** Per-member thread read watermarks (mirrors Conversation.memberLastReadAt). */
  messageReads: Record<string, string>;
  vouchers: MockVoucher[];
  contentItems: MockContentItem[];
  policies: MockPolicy[];
  /** Server-side Idempotency-Key store (API-SPECIFICATION §5.3) - key → cached response. */
  idempotency: Record<string, unknown>;
  nextCustomerId: number;
  nextSaleId: number;
  nextCommissionId: number;
  nextPayoutAccountId: number;
  nextWithdrawalId: number;
  nextLedgerId: number;
  nextVoucherId: number;
  nextContentId: number;
  nextPolicyId: number;
  nextMessageId: number;
}

export function ageFromDateOfBirth(dateOfBirth: string, now = new Date()): number {
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return -1;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function iso(daysAgo = 0, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Factory - a fresh store per `createMemberMockServer()` call so state never leaks across installs/tests. */
export function createMockStore(): MockStore {
  const programId = 'prg-domestic';

  const member = (
    partial: Omit<MockMember, 'passwordHash' | 'qualificationAnswers' | 'registeredAt'>,
  ): MockMember => ({
    ...partial,
    passwordHash: hashPassword(DEMO_PASSWORD),
    registeredAt: iso(60),
    qualificationAnswers:
      partial.status === 'PENDING' || partial.status === 'REJECTED'
        ? [
            { questionId: 'qual-001', answer: 'Yes' },
            { questionId: 'qual-002', answer: 'I understand the JA&D membership terms.' },
          ]
        : undefined,
  });

  const mem001 = member({
    id: 'mem-001',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    dateOfBirth: '1985-05-14',
    age: 41,
    gender: 'Male',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0199',
    email: 'juan.delacruz@example.com',
    referralCode: 'JAD-JUAN',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    isEmailVerified: true,
    isIdVerified: true,
    adminApproved: true,
    qualificationMet: true,
    programId,
    address: '123 Mabini St, Pasig City',
  });

  const mem002 = member({
    id: 'mem-002',
    firstName: 'Maria',
    lastName: 'Santos',
    dateOfBirth: '1990-11-02',
    age: 35,
    gender: 'Female',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0271',
    email: 'maria.santos@example.com',
    referralCode: 'JAD-MARIA',
    sponsorId: 'mem-001',
    status: 'APPROVED_ACTIVE',
    isQualified: false,
    isEmailVerified: true,
    isIdVerified: true,
    adminApproved: true,
    qualificationMet: false,
    programId,
    address: '456 Quezon Ave, Quezon City',
  });

  const mem003 = member({
    id: 'mem-003',
    firstName: 'Pedro',
    lastName: 'Pendiente',
    dateOfBirth: '1995-03-21',
    age: 31,
    gender: 'Male',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0412',
    email: 'pedro.pendiente@example.com',
    referralCode: 'JAD-PEDRO',
    status: 'PENDING',
    isQualified: false,
    isEmailVerified: true,
    isIdVerified: false,
    adminApproved: false,
    qualificationMet: false,
    programId,
  });

  const mem004 = member({
    id: 'mem-004',
    firstName: 'Ana',
    lastName: 'Anay',
    dateOfBirth: '1988-07-30',
    age: 38,
    gender: 'Female',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0777',
    email: 'ana.anay@example.com',
    referralCode: 'JAD-ANA',
    sponsorId: 'mem-001',
    status: 'REJECTED',
    isQualified: false,
    isEmailVerified: true,
    isIdVerified: false,
    adminApproved: false,
    qualificationMet: false,
    programId,
    rejectionReason:
      'Government ID was not legible - please upload a clearer copy of a valid government-issued ID.',
  });

  // F2-B: deeper network seeds - direct referrals of mem-001 (and one level
  // deeper) so Direct Referrals / Group Network / My Genealogy have data. These
  // relationships are STRICTLY single-level for commissions (BR-REF-001/002);
  // deeper tree edges exist only for the network/genealogy REPORTING views
  // (BI-004, BR-RPT-002/004) and never imply multi-level commission.
  const mem005 = member({
    id: 'mem-005',
    firstName: 'Ramon',
    lastName: 'Reyes',
    dateOfBirth: '1987-02-19',
    age: 39,
    gender: 'Male',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0833',
    email: 'ramon.reyes.member@example.com',
    referralCode: 'JAD-RAMON',
    sponsorId: 'mem-001',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    isEmailVerified: true,
    isIdVerified: true,
    adminApproved: true,
    qualificationMet: true,
    programId,
    address: '789 Banawe St, Quezon City',
  });

  const mem006 = member({
    id: 'mem-006',
    firstName: 'Liza',
    lastName: 'Lopez',
    dateOfBirth: '1993-09-08',
    age: 32,
    gender: 'Female',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0919',
    email: 'liza.lopez@example.com',
    referralCode: 'JAD-LIZA',
    sponsorId: 'mem-001',
    status: 'PENDING',
    isQualified: false,
    isEmailVerified: true,
    isIdVerified: false,
    adminApproved: false,
    qualificationMet: false,
    programId,
  });

  const mem007 = member({
    id: 'mem-007',
    firstName: 'Kevin',
    lastName: 'Kintanar',
    dateOfBirth: '1991-01-25',
    age: 35,
    gender: 'Male',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0108',
    email: 'kevin.kintanar@example.com',
    referralCode: 'JAD-KEVIN',
    sponsorId: 'mem-002',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    isEmailVerified: true,
    isIdVerified: true,
    adminApproved: true,
    qualificationMet: true,
    programId,
  });

  const mem008 = member({
    id: 'mem-008',
    firstName: 'Nina',
    lastName: 'Navarro',
    dateOfBirth: '1996-12-03',
    age: 29,
    gender: 'Female',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 555 0324',
    email: 'nina.navarro@example.com',
    referralCode: 'JAD-NINA',
    sponsorId: 'mem-005',
    status: 'REJECTED',
    isQualified: false,
    isEmailVerified: true,
    isIdVerified: false,
    adminApproved: false,
    qualificationMet: false,
    programId,
    rejectionReason:
      'The uploaded ID did not match the declared details - please verify and resubmit.',
  });

  // Transactional catalog - single source of truth with CMS (same 10 IDs as CMS_PROPERTIES_SEED / public PROPERTY_RECORDS).
  // Catalog owns: ID, category, price, status. CMS owns presentation (descriptions, highlights, gallery).
  const properties: MockProperty[] = [
    {
      id: 'igp-250-sqm-farm-lot',
      name: '250 SQM Farm Lot with Hotspring',
      value: '1200000.00',
      price: '1200000.00',
      categoryId: 'income-generating-properties',
      status: 'ACTIVE',
    },
    {
      id: 'igp-titled-hotspring-lots',
      name: 'Titled Hotspring Lots',
      value: '2000000.00',
      price: '2000000.00',
      categoryId: 'income-generating-properties',
      status: 'ACTIVE',
    },
    {
      id: 'igp-1000-sqm-hotspring-lot',
      name: '1,000 SQM Hotspring Lot',
      value: '4000000.00',
      price: '4000000.00',
      categoryId: 'income-generating-properties',
      status: 'ACTIVE',
    },
    {
      id: 'prisma-celeste-8-6m',
      name: 'Prisma Residences - Celeste Building Condo',
      value: '8600000.00',
      price: '8600000.00',
      categoryId: 'tenanted-condo-resales',
      status: 'ACTIVE',
    },
    {
      id: 'prisma-celeste-8-3m',
      name: 'Prisma Residences - Celeste Building Condo',
      value: '8300000.00',
      price: '8300000.00',
      categoryId: 'tenanted-condo-resales',
      status: 'ACTIVE',
    },
    {
      id: 'prisma-astra-1br',
      name: 'Prisma Residences - Astra Building Condo',
      value: '5300000.00',
      price: '5300000.00',
      categoryId: 'tenanted-condo-resales',
      status: 'ACTIVE',
    },
    {
      id: 'levina-place-2br',
      name: 'Levina Place - 2BR Condo',
      value: '5500000.00',
      price: '5500000.00',
      categoryId: 'tenanted-condo-resales',
      status: 'ACTIVE',
    },
    {
      id: '2-storey-house-sucat',
      name: '2-Storey House',
      value: '3200000.00',
      price: '3200000.00',
      categoryId: 'tenanted-condo-resales',
      status: 'ACTIVE',
    },
    {
      id: 'mountain-view-leisure-community',
      name: 'Mountain View Leisure Community',
      value: '0.00',
      price: undefined,
      categoryId: 'developer-project-brokerage',
      status: 'ACTIVE',
    },
    {
      id: 'mountain-suites',
      name: 'Mountain Suites',
      value: '0.00',
      price: undefined,
      categoryId: 'developer-project-brokerage',
      status: 'ACTIVE',
    },
  ];

  const customers: MockCustomer[] = [
    {
      id: 'cus-001',
      sellerId: 'mem-001',
      fullName: 'Ramon Reyes',
      phone: '+63 918 555 0101',
      email: 'ramon.reyes@example.com',
    },
    { id: 'cus-002', sellerId: 'mem-001', fullName: 'Celine Cruz', phone: '+63 918 555 0202' },
  ];

  const sale = (
    partial: Omit<MockSale, 'id' | 'sellerId' | 'sellerName' | 'submittedAt'> & { id: string },
  ): MockSale => ({
    ...partial,
    id: partial.id,
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: iso(0),
  });

  const sales: MockSale[] = [
    sale({
      status: 'SUBMITTED',
      propertyId: 'igp-250-sqm-farm-lot',
      propertyName: '250 SQM Farm Lot with Hotspring',
      propertyValue: '1200000.00',
      customerId: 'cus-001',
      customerName: 'Ramon Reyes',
      resubmissionCount: 0,
      id: 'sal-001',
    }),
    sale({
      status: 'ADMIN_APPROVED',
      propertyId: 'prisma-celeste-8-6m',
      propertyName: 'Prisma Residences - Celeste Building Condo',
      propertyValue: '8600000.00',
      customerId: 'cus-001',
      customerName: 'Ramon Reyes',
      resubmissionCount: 0,
      id: 'sal-002',
      approvedAt: iso(1),
    }),
    sale({
      status: 'PAYMENT_VERIFIED',
      propertyId: 'levina-place-2br',
      propertyName: 'Levina Place - 2BR Condo',
      propertyValue: '5500000.00',
      customerId: 'cus-002',
      customerName: 'Celine Cruz',
      resubmissionCount: 0,
      id: 'sal-003',
      approvedAt: iso(2),
      paymentVerifiedAt: iso(1),
    }),
    sale({
      status: 'QUALIFYING_SALE',
      propertyId: 'igp-titled-hotspring-lots',
      propertyName: 'Titled Hotspring Lots',
      propertyValue: '2000000.00',
      customerId: 'cus-002',
      customerName: 'Celine Cruz',
      resubmissionCount: 0,
      id: 'sal-004',
      approvedAt: iso(5),
      paymentVerifiedAt: iso(4),
    }),
    sale({
      status: 'REJECTED',
      propertyId: 'igp-1000-sqm-hotspring-lot',
      propertyName: '1,000 SQM Hotspring Lot',
      propertyValue: '4000000.00',
      customerId: 'cus-001',
      customerName: 'Ramon Reyes',
      resubmissionCount: 1,
      id: 'sal-005',
      rejectionReason:
        'Customer phone number could not be verified - please update the customer contact.',
    }),
    sale({
      status: 'LOCKED',
      propertyId: 'prisma-celeste-8-3m',
      propertyName: 'Prisma Residences - Celeste Building Condo',
      propertyValue: '8300000.00',
      customerId: 'cus-002',
      customerName: 'Celine Cruz',
      resubmissionCount: 3,
      id: 'sal-006',
      rejectionReason: 'The submitted payment reference was invalid after multiple resubmissions.',
      lockedAt: iso(1),
    }),
    sale({
      status: 'REJECTED',
      propertyId: 'igp-250-sqm-farm-lot',
      propertyName: '250 SQM Farm Lot with Hotspring',
      propertyValue: '1200000.00',
      customerId: 'cus-001',
      customerName: 'Ramon Reyes',
      resubmissionCount: 3,
      id: 'sal-010',
      rejectionReason:
        'Duplicate submission - this sale was rejected after repeated resubmissions.',
    }),
  ];

  // F2-A: qualifying sales that feed the commission/eWallet demo.
  const sal007: MockSale = sale({
    status: 'QUALIFYING_SALE',
    propertyId: 'prisma-astra-1br',
    propertyName: 'Prisma Residences - Astra Building Condo',
    propertyValue: '5300000.00',
    customerId: 'cus-002',
    customerName: 'Celine Cruz',
    resubmissionCount: 0,
    id: 'sal-007',
    approvedAt: iso(1),
    paymentVerifiedAt: iso(0),
  });
  sal007.submittedAt = iso(1);
  sales.push(sal007);

  const sal008: MockSale = sale({
    status: 'QUALIFYING_SALE',
    propertyId: 'igp-250-sqm-farm-lot',
    propertyName: '250 SQM Farm Lot with Hotspring',
    propertyValue: '1200000.00',
    customerId: 'cus-001',
    customerName: 'Ramon Reyes',
    resubmissionCount: 0,
    id: 'sal-008',
    approvedAt: iso(14),
    paymentVerifiedAt: iso(13),
  });
  sal008.submittedAt = iso(14);
  sales.push(sal008);

  const sal009: MockSale = sale({
    status: 'QUALIFYING_SALE',
    propertyId: '2-storey-house-sucat',
    propertyName: '2-Storey House',
    propertyValue: '3200000.00',
    customerId: 'cus-002',
    customerName: 'Celine Cruz',
    resubmissionCount: 0,
    id: 'sal-009',
    approvedAt: iso(12),
    paymentVerifiedAt: iso(11),
  });
  sal009.submittedAt = iso(12);
  sales.push(sal009);

  const wallet = (
    availableBalance: string,
    pendingAmount: string,
    totalWithdrawals?: string,
    totalEarned?: string,
    pendingCommission?: string,
  ): MockWallet => ({
    availableBalance,
    pendingAmount,
    pendingCommission,
    totalWithdrawals,
    totalEarned,
  });

  const notifications: MockNotification[] = [
    {
      id: 'ntf-broadcast-001',
      memberId: null,
      title: 'New properties in the catalog',
      body: 'The Admin team has added new fixed-value units to the catalog - see the Properties page.',
      createdAt: iso(2),
    },
    {
      id: 'ntf-broadcast-002',
      memberId: null,
      title: 'Community announcement',
      body: 'New marketing material and community update - find it in Marketing Tools or check the community links.',
      createdAt: iso(6),
    },
    {
      id: 'ntf-001',
      memberId: 'mem-001',
      title: 'Welcome to JA&D',
      body: 'Your membership is now Active + Qualified. You can submit sales and refer new members.',
      createdAt: iso(12),
      readAt: iso(11),
    },
    {
      id: 'ntf-002',
      memberId: 'mem-001',
      title: 'New income-generating properties in the catalog',
      body: 'The Admin team has added new fixed-value units to the catalog.',
      createdAt: iso(3),
    },
    {
      id: 'ntf-003',
      memberId: 'mem-001',
      title: 'Commission cleared',
      body: 'Your commission from sale sal-004 has cleared and is now in your Available Balance.',
      createdAt: iso(4),
    },
    {
      id: 'ntf-004',
      memberId: 'mem-001',
      title: 'New: Join the JA&D Community',
      body: 'New marketing material and community update - find it in Marketing Tools or check the community links.',
      createdAt: iso(5),
    },
    {
      id: 'ntf-005',
      memberId: 'mem-001',
      title: 'Payout account rejected',
      body: 'Your payout account (Traditional bank • •••• 7777) was rejected - Account name does not match bank record - please verify the account name and resubmit. You can add a new payout account with the correct details.',
      createdAt: iso(1),
    },
  ];

  const messages: MockMessage[] = [
    {
      id: 'msg-001',
      memberId: 'mem-001',
      senderType: 'MEMBER',
      senderName: 'Juan Member',
      body: 'Hello, I have a question about my commission.',
      createdAt: iso(3),
    },
    {
      id: 'msg-002',
      memberId: 'mem-001',
      senderType: 'STAFF',
      senderName: 'Ada Admin',
      body: 'Hi Juan! Happy to help - what would you like to know?',
      createdAt: iso(2),
    },
  ];

  const ledger: MockLedgerEntry[] = [
    {
      id: 'led-001',
      memberId: 'mem-001',
      entryType: 'DIRECT_COMMISSION',
      direction: 'CREDIT',
      amount: '160000.00',
      createdAt: iso(6),
    },
    {
      id: 'led-002',
      memberId: 'mem-001',
      entryType: 'DIRECT_REFERRAL',
      direction: 'CREDIT',
      amount: '80000.00',
      createdAt: iso(6),
    },
    {
      id: 'led-003',
      memberId: 'mem-001',
      entryType: 'DIRECT_COMMISSION',
      direction: 'CREDIT',
      amount: '96000.00',
      createdAt: iso(7),
    },
    {
      id: 'led-004',
      memberId: 'mem-001',
      entryType: 'COMMISSION_REVERSAL',
      direction: 'DEBIT',
      amount: '96000.00',
      createdAt: iso(5),
    },
    {
      id: 'led-005',
      memberId: 'mem-001',
      entryType: 'WITHDRAWAL_RESERVATION',
      direction: 'DEBIT',
      amount: '50000.00',
      createdAt: iso(7),
    },
    {
      id: 'led-006',
      memberId: 'mem-001',
      entryType: 'WITHDRAWAL_COMPLETION',
      direction: 'DEBIT',
      amount: '50000.00',
      createdAt: iso(6),
    },
    {
      id: 'led-007',
      memberId: 'mem-001',
      entryType: 'WITHDRAWAL_RESERVATION',
      direction: 'DEBIT',
      amount: '40000.00',
      createdAt: iso(4),
    },
    {
      id: 'led-008',
      memberId: 'mem-001',
      entryType: 'WITHDRAWAL_REVERSAL',
      direction: 'CREDIT',
      amount: '40000.00',
      createdAt: iso(3),
    },
    {
      id: 'led-009',
      memberId: 'mem-001',
      entryType: 'WITHDRAWAL_RESERVATION',
      direction: 'DEBIT',
      amount: '75000.00',
      createdAt: iso(0),
    },
    {
      id: 'led-010',
      memberId: 'mem-001',
      entryType: 'FINANCIAL_ADJUSTMENT',
      direction: 'CREDIT',
      amount: '25000.00',
      createdAt: iso(1),
    },
  ];

  // Commissions (mem-001) - credited immediately on qualification (sale_qualify
  // now clears inline); no PENDING state is produced. CANCELLED/REVERSED per
  // BR-CAN-001/002 are still possible for reversals.
  const commissions: MockCommission[] = [
    {
      id: 'com-001',
      memberId: 'mem-001',
      commissionType: 'DIRECT_COMMISSION',
      saleId: 'sal-004',
      baseValue: '2000000.00',
      rate: '0.0800',
      amount: '160000.00',
      status: 'AVAILABLE',
      clearedAt: iso(5),
      createdAt: iso(6),
    },
    {
      id: 'com-002',
      memberId: 'mem-001',
      commissionType: 'DIRECT_REFERRAL',
      saleId: 'sal-004',
      baseValue: '2000000.00',
      rate: '0.0400',
      amount: '80000.00',
      status: 'AVAILABLE',
      clearedAt: iso(5),
      createdAt: iso(6),
    },
    {
      id: 'com-003',
      memberId: 'mem-001',
      commissionType: 'DIRECT_COMMISSION',
      saleId: 'sal-007',
      baseValue: '5300000.00',
      rate: '0.0800',
      amount: '424000.00',
      status: 'AVAILABLE',
      clearedAt: iso(0),
      createdAt: iso(0),
    },
    {
      id: 'com-004',
      memberId: 'mem-001',
      commissionType: 'DIRECT_REFERRAL',
      saleId: 'sal-007',
      baseValue: '5300000.00',
      rate: '0.0400',
      amount: '212000.00',
      status: 'AVAILABLE',
      clearedAt: iso(0),
      createdAt: iso(0),
    },
    {
      id: 'com-005',
      memberId: 'mem-001',
      commissionType: 'DIRECT_COMMISSION',
      saleId: 'sal-008',
      baseValue: '1200000.00',
      rate: '0.0800',
      amount: '96000.00',
      status: 'REVERSED',
      clearedAt: iso(7),
      reversedAt: iso(5),
      createdAt: iso(13),
    },
    {
      id: 'com-006',
      memberId: 'mem-001',
      commissionType: 'DIRECT_REFERRAL',
      saleId: 'sal-009',
      baseValue: '3200000.00',
      rate: '0.0400',
      amount: '128000.00',
      status: 'CANCELLED',
      cancelledAt: iso(9),
      createdAt: iso(11),
    },
  ];

  // Payout accounts (mem-001) - lifecycle Pending → Admin Review → Confirmed (BR-PAY-004).
  // REJECTED is a frontend mock extension for the Approve/Reject workflow (requires Owner confirmation).
  const payoutAccounts: MockPayoutAccount[] = [
    {
      id: 'pa-001',
      memberId: 'mem-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifier: '1234567890',
      status: 'CONFIRMED',
      isPrimary: true,
      createdAt: iso(30),
    },
    {
      id: 'pa-002',
      memberId: 'mem-001',
      method: 'DIGITAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifier: '9876543210',
      status: 'CONFIRMED',
      isPrimary: false,
      createdAt: iso(25),
    },
    {
      id: 'pa-003',
      memberId: 'mem-001',
      method: 'GCASH',
      accountName: 'Juan Dela Cruz',
      accountIdentifier: '09175550199',
      status: 'PENDING',
      isPrimary: false,
      createdAt: iso(3),
    },
    {
      id: 'pa-004',
      memberId: 'mem-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifier: '111122223333',
      status: 'ADMIN_REVIEW',
      isPrimary: false,
      createdAt: iso(2),
    },
    {
      id: 'pa-005',
      memberId: 'mem-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifier: '999988887777',
      status: 'REJECTED',
      isPrimary: false,
      createdAt: iso(1),
      rejectionReason:
        'Account name does not match bank record - please verify the account name and resubmit.',
    },
  ];

  // Withdrawals (mem-001) - reservation deducts; rejection releases (BR-WDR-002/004).
  const withdrawals: MockWithdrawal[] = [
    {
      id: 'wdr-001',
      memberId: 'mem-001',
      payoutAccountId: 'pa-001',
      amount: '50000.00',
      status: 'COMPLETED',
      reservedAt: iso(7),
      completedAt: iso(6),
      externalReference: 'EXT-PAY-000123',
      createdAt: iso(7),
    },
    {
      id: 'wdr-002',
      memberId: 'mem-001',
      payoutAccountId: 'pa-002',
      amount: '40000.00',
      status: 'REJECTED',
      reservedAt: iso(4),
      rejectedAt: iso(3),
      rejectionReason:
        'The payout account name did not match the bank record. Please verify your account details and submit a new request.',
      createdAt: iso(4),
    },
    {
      id: 'wdr-003',
      memberId: 'mem-001',
      payoutAccountId: 'pa-001',
      amount: '75000.00',
      status: 'RESERVED',
      reservedAt: iso(0),
      createdAt: iso(0),
    },
  ];

  // F2-B: vouchers (mem-001) - own vouchers only (object-level, NFR-AUTHZ-002).
  // Values are exact-decimal strings; `remainingValue` is server-computed
  // (BR-VCH-002: Original − Redeemed = Remaining). Only ACTIVE / FULLY_REDEEMED
  // exist - transfer/revoke/expiry are BLOCKED on OD-019..023 (BR-VCH-007).
  const vouchers: MockVoucher[] = [
    {
      id: 'vch-001',
      code: 'JAD-VCH-2026-001',
      memberId: 'mem-001',
      title: 'Welcome Gift Voucher',
      originalValue: '500.00',
      remainingValue: '500.00',
      status: 'ACTIVE',
      createdAt: iso(30),
      expiresAt: iso(-30),
    },
    {
      id: 'vch-002',
      code: 'JAD-VCH-2026-002',
      memberId: 'mem-001',
      title: 'Referral Rewards Voucher',
      originalValue: '1000.00',
      remainingValue: '350.00',
      status: 'ACTIVE',
      createdAt: iso(14),
      expiresAt: iso(-60),
    },
    {
      id: 'vch-003',
      code: 'JAD-VCH-2026-003',
      memberId: 'mem-001',
      title: 'Season Promo Voucher',
      originalValue: '250.00',
      remainingValue: '0.00',
      status: 'FULLY_REDEEMED',
      createdAt: iso(45),
      expiresAt: iso(5),
    },
  ];

  // F2-B: forwardable marketing content (FR-ADM-003, BR-MKT-002).
  // Canonical seed lives in @jad/mock; both admin and member consume it.
  const contentItems: MockContentItem[] = MOCK_MARKETING_CONTENT;

  // F2-B: policies / program guidelines / T&C (FR-ADM-004, BR-NOT-001). Content
  // is plain text - the UI renders it safely (no raw HTML, SECURITY.md).
  const policies: MockPolicy[] = [
    {
      id: 'pol-001',
      slug: 'terms',
      title: 'Terms and Conditions',
      type: 'terms',
      content:
        'By registering for JA&D membership you agree to abide by the JA&D terms and conditions as published on the official website. Membership has no purchase requirement.\n\n' +
        '1. Acceptance of Terms\n' +
        'These terms govern your access to and use of the JA&D membership platform, including sales recording, referrals, commissions, and related services. By completing registration and verifying your email, you confirm that you are at least 18 years old, that the information you provide is accurate, and that you accept these terms in full. If you do not agree, please do not proceed with registration.\n\n' +
        '2. Member Obligations\n' +
        'Members must provide accurate personal information, maintain the confidentiality of their account credentials, and comply with all applicable laws and JA&D program guidelines. Qualifying sales must be recorded accurately against catalog properties, and referral relationships are strictly single-level - only the direct referrer is recognized for referral purposes.\n\n' +
        '3. No Purchase Requirement and Contact\n' +
        'Membership does not require the purchase of any product or property. All fees, commissions, and incentives are described in the official program guidelines. For questions about these terms, contact support@jad.example or refer to the official JA&D website.',
      updatedAt: iso(60),
    },
    {
      id: 'pol-002',
      slug: 'guidelines',
      title: 'Program Guidelines',
      type: 'guidelines',
      content:
        'These guidelines describe how qualifying sales and referrals work within the JA&D membership program.\n\n' +
        '1. Recording Qualifying Sales\n' +
        'Members who are Active and Qualified may record qualifying sales against catalog properties through the platform. Each sale must include a verified customer record and a valid property selection. Sales are reviewed by JA&D Admin and may be approved, rejected, or locked after repeated resubmissions. Only sales that reach payment verification are considered qualifying.\n\n' +
        '2. Referral Relationships\n' +
        'Members may refer new members using their personal referral code. Referral relationships are strictly single-level (direct referrer only) and are used for reporting purposes such as Direct Referrals, Group Network, and Genealogy views. Referral relationships never imply multi-level commission entitlement.\n\n' +
        '3. Qualification and Compliance\n' +
        'Members must meet the qualification checklist, including email verification, ID verification, and admin approval. Members are expected to follow the program guidelines, handle customer information responsibly, and use marketing materials only as provided through the official content library.',
      updatedAt: iso(30),
    },
    {
      id: 'pol-003',
      slug: 'privacy',
      title: 'Privacy Policy',
      type: 'privacy',
      content:
        'JA&D collects only the personal information needed to operate the membership platform. Personal data is never sold. Full details are published on the official website.\n\n' +
        '1. Information We Collect\n' +
        'We collect registration details such as name, date of birth, contact information, country, and program selection, as well as information you provide when recording sales and referrals. We also collect limited usage information necessary to operate and secure the platform.\n\n' +
        '2. How We Use Information\n' +
        'We use your information to verify your identity, evaluate your application, manage your membership, process qualifying sales and commissions, and provide member services such as eWallet, payouts, and support. We do not sell your personal information to third parties.\n\n' +
        '3. Retention and Your Choices\n' +
        'We retain information only as long as necessary for the purposes described above and as required by law. You may request access to or correction of your information by contacting support@jad.example. For the complete policy, please visit the official JA&D website.',
      updatedAt: iso(90),
    },
  ];

  return {
    minAge: 18,
    genders: ['Male', 'Female', 'Others'],
    withdrawalLimits: { min: '100.00', max: '50000.00' },
    // ISO 3166-1 alpha-2 master - mirrors supabase/migrations/20260831000004_countries.sql
    // Do NOT use for coordinate detection; provider resolves country, this is identity/reference only.
    countries: [
      { code: 'AF', name: 'Afghanistan' },
      { code: 'AL', name: 'Albania' },
      { code: 'DZ', name: 'Algeria' },
      { code: 'AS', name: 'American Samoa' },
      { code: 'AD', name: 'Andorra' },
      { code: 'AO', name: 'Angola' },
      { code: 'AI', name: 'Anguilla' },
      { code: 'AQ', name: 'Antarctica' },
      { code: 'AG', name: 'Antigua and Barbuda' },
      { code: 'AR', name: 'Argentina' },
      { code: 'AM', name: 'Armenia' },
      { code: 'AW', name: 'Aruba' },
      { code: 'AU', name: 'Australia' },
      { code: 'AT', name: 'Austria' },
      { code: 'AZ', name: 'Azerbaijan' },
      { code: 'BS', name: 'Bahamas' },
      { code: 'BH', name: 'Bahrain' },
      { code: 'BD', name: 'Bangladesh' },
      { code: 'BB', name: 'Barbados' },
      { code: 'BY', name: 'Belarus' },
      { code: 'BE', name: 'Belgium' },
      { code: 'BZ', name: 'Belize' },
      { code: 'BJ', name: 'Benin' },
      { code: 'BM', name: 'Bermuda' },
      { code: 'BT', name: 'Bhutan' },
      { code: 'BO', name: 'Bolivia (Plurinational State of)' },
      { code: 'BQ', name: 'Bonaire, Sint Eustatius and Saba' },
      { code: 'BA', name: 'Bosnia and Herzegovina' },
      { code: 'BW', name: 'Botswana' },
      { code: 'BV', name: 'Bouvet Island' },
      { code: 'BR', name: 'Brazil' },
      { code: 'IO', name: 'British Indian Ocean Territory' },
      { code: 'BN', name: 'Brunei Darussalam' },
      { code: 'BG', name: 'Bulgaria' },
      { code: 'BF', name: 'Burkina Faso' },
      { code: 'BI', name: 'Burundi' },
      { code: 'CV', name: 'Cabo Verde' },
      { code: 'KH', name: 'Cambodia' },
      { code: 'CM', name: 'Cameroon' },
      { code: 'CA', name: 'Canada' },
      { code: 'KY', name: 'Cayman Islands' },
      { code: 'CF', name: 'Central African Republic' },
      { code: 'TD', name: 'Chad' },
      { code: 'CL', name: 'Chile' },
      { code: 'CN', name: 'China' },
      { code: 'CX', name: 'Christmas Island' },
      { code: 'CC', name: 'Cocos (Keeling) Islands' },
      { code: 'CO', name: 'Colombia' },
      { code: 'KM', name: 'Comoros' },
      { code: 'CG', name: 'Congo' },
      { code: 'CD', name: 'Congo, Democratic Republic of the' },
      { code: 'CK', name: 'Cook Islands' },
      { code: 'CR', name: 'Costa Rica' },
      { code: 'HR', name: 'Croatia' },
      { code: 'CU', name: 'Cuba' },
      { code: 'CW', name: 'Curaçao' },
      { code: 'CY', name: 'Cyprus' },
      { code: 'CZ', name: 'Czechia' },
      { code: 'DK', name: 'Denmark' },
      { code: 'DJ', name: 'Djibouti' },
      { code: 'DM', name: 'Dominica' },
      { code: 'DO', name: 'Dominican Republic' },
      { code: 'EC', name: 'Ecuador' },
      { code: 'EG', name: 'Egypt' },
      { code: 'SV', name: 'El Salvador' },
      { code: 'GQ', name: 'Equatorial Guinea' },
      { code: 'ER', name: 'Eritrea' },
      { code: 'EE', name: 'Estonia' },
      { code: 'SZ', name: 'Eswatini' },
      { code: 'ET', name: 'Ethiopia' },
      { code: 'FK', name: 'Falkland Islands (Malvinas)' },
      { code: 'FO', name: 'Faroe Islands' },
      { code: 'FJ', name: 'Fiji' },
      { code: 'FI', name: 'Finland' },
      { code: 'FR', name: 'France' },
      { code: 'GF', name: 'French Guiana' },
      { code: 'PF', name: 'French Polynesia' },
      { code: 'TF', name: 'French Southern Territories' },
      { code: 'GA', name: 'Gabon' },
      { code: 'GM', name: 'Gambia' },
      { code: 'GE', name: 'Georgia' },
      { code: 'DE', name: 'Germany' },
      { code: 'GH', name: 'Ghana' },
      { code: 'GI', name: 'Gibraltar' },
      { code: 'GR', name: 'Greece' },
      { code: 'GL', name: 'Greenland' },
      { code: 'GD', name: 'Grenada' },
      { code: 'GP', name: 'Guadeloupe' },
      { code: 'GU', name: 'Guam' },
      { code: 'GT', name: 'Guatemala' },
      { code: 'GG', name: 'Guernsey' },
      { code: 'GN', name: 'Guinea' },
      { code: 'GW', name: 'Guinea-Bissau' },
      { code: 'GY', name: 'Guyana' },
      { code: 'HT', name: 'Haiti' },
      { code: 'HM', name: 'Heard Island and McDonald Islands' },
      { code: 'VA', name: 'Holy See' },
      { code: 'HN', name: 'Honduras' },
      { code: 'HK', name: 'Hong Kong' },
      { code: 'HU', name: 'Hungary' },
      { code: 'IS', name: 'Iceland' },
      { code: 'IN', name: 'India' },
      { code: 'ID', name: 'Indonesia' },
      { code: 'IR', name: 'Iran (Islamic Republic of)' },
      { code: 'IQ', name: 'Iraq' },
      { code: 'IE', name: 'Ireland' },
      { code: 'IM', name: 'Isle of Man' },
      { code: 'IL', name: 'Israel' },
      { code: 'IT', name: 'Italy' },
      { code: 'JM', name: 'Jamaica' },
      { code: 'JP', name: 'Japan' },
      { code: 'JE', name: 'Jersey' },
      { code: 'JO', name: 'Jordan' },
      { code: 'KZ', name: 'Kazakhstan' },
      { code: 'KE', name: 'Kenya' },
      { code: 'KI', name: 'Kiribati' },
      { code: 'KP', name: "Korea (Democratic People's Republic of)" },
      { code: 'KR', name: 'Korea, Republic of' },
      { code: 'KW', name: 'Kuwait' },
      { code: 'KG', name: 'Kyrgyzstan' },
      { code: 'LA', name: "Lao People's Democratic Republic" },
      { code: 'LV', name: 'Latvia' },
      { code: 'LB', name: 'Lebanon' },
      { code: 'LS', name: 'Lesotho' },
      { code: 'LR', name: 'Liberia' },
      { code: 'LY', name: 'Libya' },
      { code: 'LI', name: 'Liechtenstein' },
      { code: 'LT', name: 'Lithuania' },
      { code: 'LU', name: 'Luxembourg' },
      { code: 'MO', name: 'Macao' },
      { code: 'MG', name: 'Madagascar' },
      { code: 'MW', name: 'Malawi' },
      { code: 'MY', name: 'Malaysia' },
      { code: 'MV', name: 'Maldives' },
      { code: 'ML', name: 'Mali' },
      { code: 'MT', name: 'Malta' },
      { code: 'MH', name: 'Marshall Islands' },
      { code: 'MQ', name: 'Martinique' },
      { code: 'MR', name: 'Mauritania' },
      { code: 'MU', name: 'Mauritius' },
      { code: 'YT', name: 'Mayotte' },
      { code: 'MX', name: 'Mexico' },
      { code: 'FM', name: 'Micronesia (Federated States of)' },
      { code: 'MD', name: 'Moldova, Republic of' },
      { code: 'MC', name: 'Monaco' },
      { code: 'MN', name: 'Mongolia' },
      { code: 'ME', name: 'Montenegro' },
      { code: 'MS', name: 'Montserrat' },
      { code: 'MA', name: 'Morocco' },
      { code: 'MZ', name: 'Mozambique' },
      { code: 'MM', name: 'Myanmar' },
      { code: 'NA', name: 'Namibia' },
      { code: 'NR', name: 'Nauru' },
      { code: 'NP', name: 'Nepal' },
      { code: 'NL', name: 'Netherlands' },
      { code: 'NC', name: 'New Caledonia' },
      { code: 'NZ', name: 'New Zealand' },
      { code: 'NI', name: 'Nicaragua' },
      { code: 'NE', name: 'Niger' },
      { code: 'NG', name: 'Nigeria' },
      { code: 'NU', name: 'Niue' },
      { code: 'NF', name: 'Norfolk Island' },
      { code: 'MK', name: 'North Macedonia' },
      { code: 'MP', name: 'Northern Mariana Islands' },
      { code: 'NO', name: 'Norway' },
      { code: 'OM', name: 'Oman' },
      { code: 'PK', name: 'Pakistan' },
      { code: 'PW', name: 'Palau' },
      { code: 'PS', name: 'Palestine, State of' },
      { code: 'PA', name: 'Panama' },
      { code: 'PG', name: 'Papua New Guinea' },
      { code: 'PY', name: 'Paraguay' },
      { code: 'PE', name: 'Peru' },
      { code: 'PH', name: 'Philippines', dialCode: '63', phoneMin: 10, phoneMax: 10, phonePattern: '^9[0-9]{9}$' },
      { code: 'PN', name: 'Pitcairn' },
      { code: 'PL', name: 'Poland' },
      { code: 'PT', name: 'Portugal' },
      { code: 'PR', name: 'Puerto Rico' },
      { code: 'QA', name: 'Qatar' },
      { code: 'RE', name: 'Réunion' },
      { code: 'RO', name: 'Romania' },
      { code: 'RU', name: 'Russian Federation' },
      { code: 'RW', name: 'Rwanda' },
      { code: 'BL', name: 'Saint Barthélemy' },
      { code: 'SH', name: 'Saint Helena, Ascension and Tristan da Cunha' },
      { code: 'KN', name: 'Saint Kitts and Nevis' },
      { code: 'LC', name: 'Saint Lucia' },
      { code: 'MF', name: 'Saint Martin (French part)' },
      { code: 'PM', name: 'Saint Pierre and Miquelon' },
      { code: 'VC', name: 'Saint Vincent and the Grenadines' },
      { code: 'WS', name: 'Samoa' },
      { code: 'SM', name: 'San Marino' },
      { code: 'ST', name: 'Sao Tome and Principe' },
      { code: 'SA', name: 'Saudi Arabia' },
      { code: 'SN', name: 'Senegal' },
      { code: 'RS', name: 'Serbia' },
      { code: 'SC', name: 'Seychelles' },
      { code: 'SL', name: 'Sierra Leone' },
      { code: 'SG', name: 'Singapore' },
      { code: 'SX', name: 'Sint Maarten (Dutch part)' },
      { code: 'SK', name: 'Slovakia' },
      { code: 'SI', name: 'Slovenia' },
      { code: 'SB', name: 'Solomon Islands' },
      { code: 'SO', name: 'Somalia' },
      { code: 'ZA', name: 'South Africa' },
      { code: 'GS', name: 'South Georgia and the South Sandwich Islands' },
      { code: 'SS', name: 'South Sudan' },
      { code: 'ES', name: 'Spain' },
      { code: 'LK', name: 'Sri Lanka' },
      { code: 'SD', name: 'Sudan' },
      { code: 'SR', name: 'Suriname' },
      { code: 'SJ', name: 'Svalbard and Jan Mayen' },
      { code: 'SE', name: 'Sweden' },
      { code: 'CH', name: 'Switzerland' },
      { code: 'SY', name: 'Syrian Arab Republic' },
      { code: 'TW', name: 'Taiwan, Province of China' },
      { code: 'TJ', name: 'Tajikistan' },
      { code: 'TZ', name: 'Tanzania, United Republic of' },
      { code: 'TH', name: 'Thailand' },
      { code: 'TL', name: 'Timor-Leste' },
      { code: 'TG', name: 'Togo' },
      { code: 'TK', name: 'Tokelau' },
      { code: 'TO', name: 'Tonga' },
      { code: 'TT', name: 'Trinidad and Tobago' },
      { code: 'TN', name: 'Tunisia' },
      { code: 'TR', name: 'Türkiye' },
      { code: 'TM', name: 'Turkmenistan' },
      { code: 'TC', name: 'Turks and Caicos Islands' },
      { code: 'TV', name: 'Tuvalu' },
      { code: 'UG', name: 'Uganda' },
      { code: 'UA', name: 'Ukraine' },
      { code: 'AE', name: 'United Arab Emirates' },
      { code: 'GB', name: 'United Kingdom of Great Britain and Northern Ireland' },
      { code: 'US', name: 'United States of America' },
      { code: 'UM', name: 'United States Minor Outlying Islands' },
      { code: 'UY', name: 'Uruguay' },
      { code: 'UZ', name: 'Uzbekistan' },
      { code: 'VU', name: 'Vanuatu' },
      { code: 'VE', name: 'Venezuela (Bolivarian Republic of)' },
      { code: 'VN', name: 'Viet Nam' },
      { code: 'VG', name: 'Virgin Islands (British)' },
      { code: 'VI', name: 'Virgin Islands (U.S.)' },
      { code: 'WF', name: 'Wallis and Futuna' },
      { code: 'EH', name: 'Western Sahara' },
      { code: 'YE', name: 'Yemen' },
      { code: 'ZM', name: 'Zambia' },
      { code: 'ZW', name: 'Zimbabwe' },
    ],
    programs: [
      {
        id: 'prg-domestic',
        code: 'DOMESTIC',
        name: 'Domestic Program',
        description:
          'For members based in the Philippines. Covers local property transactions and domestic referral networks.',
      },
      {
        id: 'prg-abroad',
        code: 'ABROAD',
        name: 'Abroad Program',
        description:
          'For Overseas Filipino Workers (OFW) and international members. Covers foreign property listings and cross-border referrals.',
      },
    ],
    qualificationQuestions: [
      {
        id: 'qual-001',
        questionText: 'Are you at least 18 years old and able to enter into a contract?',
      },
      {
        id: 'qual-002',
        questionText:
          'Do you understand that membership has no purchase requirement and that commissions apply only to qualifying sales?',
      },
    ],
    members: [mem001, mem002, mem003, mem004, mem005, mem006, mem007, mem008],
    properties,
    customers,
    sales,
    wallets: {
      'mem-001': wallet('776000.00', '0.00', '125000.00', '876000.00', '1224000.00'),
      'mem-002': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-003': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-004': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-005': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-006': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-007': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
      'mem-008': wallet('0.00', '0.00', '0.00', '0.00', '0.00'),
    },
    ledger,
    commissions,
    payoutAccounts,
    withdrawals,
    notifications,
    messages,
    messageReads: {},
    vouchers,
    contentItems,
    policies,
    idempotency: {},
    nextCustomerId: 3,
    nextSaleId: 11,
    nextCommissionId: 7,
    nextPayoutAccountId: 6,
    nextWithdrawalId: 4,
    nextLedgerId: 11,
    nextVoucherId: 4,
    nextContentId: 4,
    nextPolicyId: 4,
    nextMessageId: 3,
  };
}
