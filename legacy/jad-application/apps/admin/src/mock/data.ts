import { CMS_PROPERTIES_SEED } from '@jad/contracts';
import { MOCK_MARKETING_CONTENT } from '@jad/mock';
import type {
  CatalogProperty,
  MemberAccount,
  MemberProfile,
  Sale,
  PayoutAccount,
  Withdrawal,
  Voucher,
  Program,
} from '@jad/contracts';

/** Extended sale type with optional referrer and customer contact fields for mock-only admin forms. */
export type MockSale = Sale & {
  referrerName?: string;
  referrerId?: string;
  customerPhone?: string;
  customerEmail?: string;
};

/** Extended withdrawal type with balance for mock-only admin detail view. */
export type MockWithdrawal = Withdrawal & { balance?: string };

/** Extended voucher type with member assignment for mock-only admin forms. */
export type MockVoucher = Voucher & { issuedTo?: string; issuedToMemberId?: string };

/** Voucher template - defines a voucher type that can be assigned to members. */
export type VoucherTemplate = {
  id: string;
  title: string;
  originalValue: string;
  /** Fixed expiry date (ISO). Takes precedence over validityDays. */
  expiresAt?: string;
  /** Days from issuance. Applied only when no fixed date is set. */
  validityDays?: number;
  createdAt: string;
};

/** Voucher assignment - an instance of a template assigned to a specific member. */
export type VoucherAssignment = Voucher & {
  templateId: string;
  memberId: string;
  memberName: string;
};

/**
 * Fictional mock registrations for the F0 registrations queue. 12 rows exercise
 * pagination (page size 10). Strictly mock data - lives behind the API-shaped
 * mock server, never inside page components.
 */
export const MOCK_REGISTRATIONS: MemberAccount[] = [
  {
    id: 'reg-001',
    name: 'Juan Dela Cruz',
    email: 'juan.delacruz@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-18T09:12:00.000Z',
  },
  {
    id: 'reg-002',
    name: 'Maria Santos',
    email: 'maria.santos@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-18T08:40:00.000Z',
  },
  {
    id: 'reg-003',
    name: 'Pedro Reyes',
    email: 'pedro.reyes@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-18T07:55:00.000Z',
  },
  {
    id: 'reg-004',
    name: 'Ana Lopez',
    email: 'ana.lopez@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-17T16:20:00.000Z',
  },
  {
    id: 'reg-005',
    name: 'Ramon Garcia',
    email: 'ramon.garcia@example.com',
    status: 'REJECTED',
    registeredAt: '2026-08-17T15:05:00.000Z',
  },
  {
    id: 'reg-006',
    name: 'Liza Fernandez',
    email: 'liza.fernandez@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-17T11:30:00.000Z',
  },
  {
    id: 'reg-007',
    name: 'Marco Aquino',
    email: 'marco.aquino@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-17T10:15:00.000Z',
  },
  {
    id: 'reg-008',
    name: 'Nina Villanueva',
    email: 'nina.villanueva@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-16T14:50:00.000Z',
  },
  {
    id: 'reg-009',
    name: 'Oscar Mendoza',
    email: 'oscar.mendoza@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-16T13:35:00.000Z',
  },
  {
    id: 'reg-010',
    name: 'Paula Ramos',
    email: 'paula.ramos@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-16T09:45:00.000Z',
  },
  {
    id: 'reg-011',
    name: 'Dante Morales',
    email: 'dante.morales@example.com',
    status: 'PENDING',
    registeredAt: '2026-08-15T17:25:00.000Z',
  },
  {
    id: 'reg-012',
    name: 'Elena Navarro',
    email: 'elena.navarro@example.com',
    status: 'REJECTED',
    registeredAt: '2026-08-15T12:10:00.000Z',
  },
];

/** Mock sales across the documented state machine (API-SPECIFICATION §6.6).
 * Property references are transactional catalog IDs (same IDs as CMS/public/member)
 * so Admin ↔ Member ↔ Public Website share a single source of truth.
 * sellerId/sellerName identifies who submitted the sale (the member/seller).
 */
export const MOCK_SALES: MockSale[] = [
  {
    id: 'sal-001',
    status: 'SUBMITTED',
    propertyId: 'igp-250-sqm-farm-lot',
    propertyName: '250 SQM Farm Lot with Hotspring',
    propertyValue: '1200000.00',
    customerId: 'cust-001',
    customerName: 'Ramon Reyes',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-18T09:00:00.000Z',
    resubmissionCount: 0,
  },
  {
    id: 'sal-002',
    status: 'ADMIN_APPROVED',
    propertyId: 'prisma-celeste-8-6m',
    propertyName: 'Prisma Residences - Celeste Building Condo',
    propertyValue: '8600000.00',
    customerId: 'cust-001',
    customerName: 'Ramon Reyes',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-17T10:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-17T11:00:00.000Z',
  },
  {
    id: 'sal-003',
    status: 'PAYMENT_VERIFIED',
    propertyId: 'levina-place-2br',
    propertyName: 'Levina Place - 2BR Condo',
    propertyValue: '5500000.00',
    customerId: 'cust-002',
    customerName: 'Celine Cruz',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-16T10:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-16T12:00:00.000Z',
    paymentVerifiedAt: '2026-08-16T14:00:00.000Z',
  },
  {
    id: 'sal-004',
    status: 'QUALIFYING_SALE',
    propertyId: 'igp-titled-hotspring-lots',
    propertyName: 'Titled Hotspring Lots',
    propertyValue: '2000000.00',
    customerId: 'cust-002',
    customerName: 'Celine Cruz',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-15T10:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-15T12:00:00.000Z',
    paymentVerifiedAt: '2026-08-15T14:00:00.000Z',
  },
  {
    id: 'sal-005',
    status: 'REJECTED',
    propertyId: 'igp-1000-sqm-hotspring-lot',
    propertyName: '1,000 SQM Hotspring Lot',
    propertyValue: '4000000.00',
    customerId: 'cust-001',
    customerName: 'Ramon Reyes',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-14T10:00:00.000Z',
    resubmissionCount: 1,
    rejectionReason:
      'Customer phone number could not be verified - please update the customer contact.',
  },
  {
    id: 'sal-006',
    status: 'LOCKED',
    propertyId: 'prisma-celeste-8-3m',
    propertyName: 'Prisma Residences - Celeste Building Condo',
    propertyValue: '8300000.00',
    customerId: 'cust-002',
    customerName: 'Celine Cruz',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-13T10:00:00.000Z',
    resubmissionCount: 3,
    rejectionReason: 'The submitted payment reference was invalid after multiple resubmissions.',
    lockedAt: '2026-08-13T14:00:00.000Z',
  },
  {
    id: 'sal-007',
    status: 'QUALIFYING_SALE',
    propertyId: 'prisma-astra-1br',
    propertyName: 'Prisma Residences - Astra Building Condo',
    propertyValue: '5300000.00',
    customerId: 'cust-002',
    customerName: 'Celine Cruz',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-12T09:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-12T10:00:00.000Z',
    paymentVerifiedAt: '2026-08-12T12:00:00.000Z',
  },
  {
    id: 'sal-008',
    status: 'QUALIFYING_SALE',
    propertyId: 'igp-250-sqm-farm-lot',
    propertyName: '250 SQM Farm Lot with Hotspring',
    propertyValue: '1200000.00',
    customerId: 'cust-001',
    customerName: 'Ramon Reyes',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-11T09:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-11T10:00:00.000Z',
    paymentVerifiedAt: '2026-08-11T12:00:00.000Z',
  },
  {
    id: 'sal-009',
    status: 'QUALIFYING_SALE',
    propertyId: 'levina-place-2br',
    propertyName: 'Levina Place - 2BR Condo',
    propertyValue: '5500000.00',
    customerId: 'cust-002',
    customerName: 'Celine Cruz',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-10T09:00:00.000Z',
    resubmissionCount: 0,
    approvedAt: '2026-08-10T10:00:00.000Z',
    paymentVerifiedAt: '2026-08-10T12:00:00.000Z',
  },
  {
    id: 'sal-010',
    status: 'REJECTED',
    propertyId: 'igp-250-sqm-farm-lot',
    propertyName: '250 SQM Farm Lot with Hotspring',
    propertyValue: '1200000.00',
    customerId: 'cust-001',
    customerName: 'Ramon Reyes',
    sellerId: 'mem-001',
    sellerName: 'Juan Dela Cruz',
    submittedAt: '2026-08-09T10:00:00.000Z',
    resubmissionCount: 3,
    rejectionReason: 'Duplicate submission - this sale was rejected after repeated resubmissions.',
  },
];

/** Mock payout accounts across documented states (API-SPECIFICATION §6.9). */
export const MOCK_PAYOUT_ACCOUNTS: PayoutAccount[] = [
  {
    id: 'pac-001',
    method: 'TRADITIONAL_BANK',
    accountName: 'Juan Dela Cruz',
    accountIdentifierMasked: '09171234567',
    status: 'PENDING',
    isPrimary: false,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  {
    id: 'pac-002',
    method: 'DIGITAL_BANK',
    accountName: 'Maria Santos',
    accountIdentifierMasked: '123456789012',
    status: 'ADMIN_REVIEW',
    isPrimary: true,
    createdAt: '2026-08-14T14:30:00.000Z',
  },
  {
    id: 'pac-003',
    method: 'GCASH',
    accountName: 'Pedro Reyes',
    accountIdentifierMasked: '09187654321',
    status: 'CONFIRMED',
    isPrimary: false,
    createdAt: '2026-08-13T09:15:00.000Z',
  },
  {
    id: 'pac-004',
    method: 'TRADITIONAL_BANK',
    accountName: 'Ana Anay',
    accountIdentifierMasked: '021987654321',
    status: 'REJECTED',
    isPrimary: false,
    createdAt: '2026-08-12T10:00:00.000Z',
    rejectionReason: 'Account name does not match bank record - please verify and resubmit.',
  },
  {
    id: 'pac-005',
    method: 'GCASH',
    accountName: 'Liza Lopez',
    accountIdentifierMasked: '09201234567',
    status: 'CONFIRMED',
    isPrimary: true,
    createdAt: '2026-08-11T08:00:00.000Z',
  },
  {
    id: 'pac-006',
    method: 'TRADITIONAL_BANK',
    accountName: 'Kevin Kintanar',
    accountIdentifierMasked: '1098765432',
    status: 'PENDING',
    isPrimary: false,
    createdAt: '2026-08-10T12:00:00.000Z',
  },
  {
    id: 'pac-007',
    method: 'DIGITAL_BANK',
    accountName: 'Nina Navarro',
    accountIdentifierMasked: '987654321098',
    status: 'CONFIRMED',
    isPrimary: false,
    createdAt: '2026-08-09T11:30:00.000Z',
  },
  {
    id: 'pac-008',
    method: 'OTHER',
    accountName: 'Ramon Reyes',
    accountIdentifierMasked: 'JP-12345678',
    status: 'ADMIN_REVIEW',
    isPrimary: false,
    createdAt: '2026-08-08T09:00:00.000Z',
  },
];

/**
 * Mock withdrawals across the documented state machine (API-SPECIFICATION §6.10).
 * wdr-001…003 mirror the member wallet (same ids, amounts, statuses); wdr-004+
 * are fellow-member rows under fresh ids so no id means two things.
 */
export const MOCK_WITHDRAWALS: MockWithdrawal[] = [
  {
    id: 'wdr-001',
    amount: '50000.00',
    status: 'COMPLETED',
    balance: '90000.00',
    payoutAccount: {
      id: 'pac-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '09171234567',
    },
    reservedAt: '2026-08-18T10:00:00.000Z',
    completedAt: '2026-08-18T11:00:00.000Z',
    createdAt: '2026-08-18T09:00:00.000Z',
  },
  {
    id: 'wdr-002',
    amount: '40000.00',
    status: 'REJECTED',
    balance: '90000.00',
    payoutAccount: {
      id: 'pac-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '09171234567',
    },
    rejectedAt: '2026-08-17T15:00:00.000Z',
    createdAt: '2026-08-17T13:30:00.000Z',
    rejectionReason: 'Duplicate withdrawal request',
  },
  {
    id: 'wdr-003',
    amount: '75000.00',
    status: 'RESERVED',
    balance: '90000.00',
    payoutAccount: {
      id: 'pac-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '09171234567',
    },
    reservedAt: '2026-08-16T09:00:00.000Z',
    createdAt: '2026-08-15T16:00:00.000Z',
  },
  {
    id: 'wdr-004',
    amount: '1200.00',
    status: 'RESERVED',
    balance: '3800.00',
    payoutAccount: {
      id: 'pac-002',
      method: 'DIGITAL_BANK',
      accountName: 'Maria Santos',
      accountIdentifierMasked: '123456789012',
    },
    reservedAt: '2026-08-17T14:00:00.000Z',
    createdAt: '2026-08-17T13:30:00.000Z',
  },
  {
    id: 'wdr-005',
    amount: '300.00',
    status: 'COMPLETED',
    balance: '1700.00',
    payoutAccount: {
      id: 'pac-003',
      method: 'GCASH',
      accountName: 'Pedro Reyes',
      accountIdentifierMasked: '09187654321',
    },
    reservedAt: '2026-08-16T09:00:00.000Z',
    completedAt: '2026-08-16T10:00:00.000Z',
    createdAt: '2026-08-15T16:00:00.000Z',
  },
  {
    id: 'wdr-006',
    amount: '750.00',
    status: 'REJECTED',
    balance: '500.00',
    payoutAccount: {
      id: 'pac-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '09171234567',
    },
    rejectedAt: '2026-08-17T15:00:00.000Z',
    createdAt: '2026-08-17T14:30:00.000Z',
    rejectionReason: 'Insufficient balance',
  },
];

/** Mock voucher templates - voucher types that can be assigned to members. */
export const MOCK_VOUCHERS: VoucherTemplate[] = [
  {
    id: 'vtpl-001',
    title: 'Welcome Gift',
    originalValue: '500.00',
    createdAt: '2026-08-01T10:00:00.000Z',
    expiresAt: '2026-12-31T10:00:00.000Z',
  },
  {
    id: 'vtpl-002',
    title: 'Referral Rewards',
    originalValue: '1000.00',
    createdAt: '2026-08-02T14:30:00.000Z',
    validityDays: 90,
  },
  {
    id: 'vtpl-003',
    title: 'Season Promo',
    originalValue: '250.00',
    createdAt: '2026-08-03T16:00:00.000Z',
    // No expiry - open-ended
  },
  {
    id: 'vtpl-004',
    title: 'Birthday Bonus',
    originalValue: '200.00',
    createdAt: '2026-08-04T08:00:00.000Z',
    validityDays: 30,
  },
  {
    id: 'vtpl-005',
    title: 'Loyalty Reward',
    originalValue: '750.00',
    createdAt: '2026-08-05T09:00:00.000Z',
    expiresAt: '2026-11-30T09:00:00.000Z',
  },
];

/** Mock voucher assignments - individual vouchers assigned to members. */
export const MOCK_VOUCHER_ASSIGNMENTS: VoucherAssignment[] = [
  {
    id: 'vch-101',
    templateId: 'vtpl-001',
    code: 'JAD-VCH-2026-101',
    title: 'Welcome Gift',
    originalValue: '500.00',
    remainingValue: '500.00',
    status: 'ACTIVE',
    memberId: 'mem-001',
    memberName: 'Juan Dela Cruz',
    createdAt: '2026-08-17T10:00:00.000Z',
    expiresAt: '2026-12-31T10:00:00.000Z',
  },
  {
    id: 'vch-102',
    templateId: 'vtpl-001',
    code: 'JAD-VCH-2026-102',
    title: 'Welcome Gift',
    originalValue: '500.00',
    remainingValue: '500.00',
    status: 'ACTIVE',
    memberId: 'mem-010',
    memberName: 'Pedro Reyes',
    createdAt: '2026-08-18T11:00:00.000Z',
    expiresAt: '2026-12-31T10:00:00.000Z',
  },
  {
    id: 'vch-103',
    templateId: 'vtpl-002',
    code: 'JAD-VCH-2026-103',
    title: 'Referral Rewards',
    originalValue: '1000.00',
    remainingValue: '350.00',
    status: 'ACTIVE',
    memberId: 'mem-006',
    memberName: 'Liza Lopez',
    createdAt: '2026-08-16T14:30:00.000Z',
    // validityDays=90 from template → 2026-08-16 + 90 = 2026-11-14
    expiresAt: '2026-11-14T14:30:00.000Z',
  },
  {
    id: 'vch-104',
    templateId: 'vtpl-003',
    code: 'JAD-VCH-2026-104',
    title: 'Season Promo',
    originalValue: '250.00',
    remainingValue: '0.00',
    status: 'FULLY_REDEEMED',
    memberId: 'mem-001',
    memberName: 'Juan Dela Cruz',
    createdAt: '2026-08-15T16:00:00.000Z',
    // No expiry (template has no rule)
  },
  {
    id: 'vch-105',
    templateId: 'vtpl-002',
    code: 'JAD-VCH-2026-105',
    title: 'Referral Rewards',
    originalValue: '1000.00',
    remainingValue: '1000.00',
    status: 'ACTIVE',
    memberId: 'mem-009',
    memberName: 'Oscar Mendoza',
    createdAt: '2026-08-19T09:00:00.000Z',
    // validityDays=90 from template → 2026-08-19 + 90 = 2026-11-17
    expiresAt: '2026-11-17T09:00:00.000Z',
  },
  {
    id: 'vch-106',
    templateId: 'vtpl-004',
    code: 'JAD-VCH-2026-106',
    title: 'Birthday Bonus',
    originalValue: '200.00',
    remainingValue: '200.00',
    status: 'ACTIVE',
    memberId: 'mem-010',
    memberName: 'Pedro Reyes',
    createdAt: '2026-08-20T08:00:00.000Z',
    // validityDays=30 from template → 2026-08-20 + 30 = 2026-09-19
    expiresAt: '2026-09-19T08:00:00.000Z',
  },
];

/**
 * Mock property catalog records - transactional system-of-record.
 * Catalog owns: ID, category, price, status. CMS owns presentation
 * (descriptions, highlights, gallery). Both reference the same property ID.
 * Derived from CMS_PROPERTIES_SEED so Admin ↔ Member ↔ Public Website
 * share a single source of truth for mock property/category data.
 * Future DB: `properties(id PK, category_id FK, price numeric, status)`.
 */
export const MOCK_PROPERTIES: CatalogProperty[] = CMS_PROPERTIES_SEED.properties.map(
  (p, index) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    price: p.price,
    // One inactive sample for filtering/edge-case testing; rest ACTIVE
    status: index === 7 ? 'INACTIVE' : 'ACTIVE',
  }),
);

/**
 * Mock member profiles for admin member list/detail (API-SPECIFICATION #8/#9).
 * Single member universe shared with the web/member mock store: mem-001 is
 * Juan Dela Cruz everywhere. mem-009/mem-010 extend the roster with
 * admin-narrative members absent from the web seed.
 */
export const MOCK_MEMBERS: MemberProfile[] = [
  {
    id: 'mem-001',
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    dateOfBirth: '1992-03-14',
    age: 34,
    gender: 'Male',
    address: '123 Mabini St, Quezon City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 111 0001',
    email: 'juan.delacruz@example.com',
    referralCode: 'JD-2026-001',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-002',
    firstName: 'Maria',
    lastName: 'Santos',
    dateOfBirth: '1990-05-15',
    age: 36,
    gender: 'Female',
    address: '123 Rizal Ave, Makati City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 917 123 4567',
    email: 'maria.santos@example.com',
    referralCode: 'MS-2026-002',
    status: 'APPROVED_ACTIVE',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-003',
    firstName: 'Pedro',
    lastName: 'Pendiente',
    dateOfBirth: '1988-07-22',
    age: 38,
    gender: 'Male',
    address: 'Shibuya 2-24-12, Tokyo',
    countryCode: 'JP',
    countryName: 'Japan',
    phone: '+81 90 1111 2222',
    email: 'pedro.pendiente@example.com',
    referralCode: 'PP-2026-003',
    status: 'PENDING',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-004',
    firstName: 'Ana',
    lastName: 'Anay',
    dateOfBirth: '1994-02-10',
    age: 32,
    gender: 'Female',
    address: '77 San Roque St, Cavite City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 918 222 3344',
    email: 'ana.anay@example.com',
    referralCode: 'AA-2026-004',
    status: 'REJECTED',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-005',
    firstName: 'Ramon',
    lastName: 'Reyes',
    dateOfBirth: '1986-09-03',
    age: 39,
    gender: 'Male',
    address: '45 Real St, Intramuros, Manila',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 919 333 4455',
    email: 'ramon.reyes.member@example.com',
    referralCode: 'RR-2026-005',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-006',
    firstName: 'Liza',
    lastName: 'Lopez',
    dateOfBirth: '1993-12-19',
    age: 32,
    gender: 'Female',
    address: '9 Malakas St, Diliman, Quezon City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 920 444 5566',
    email: 'liza.lopez@example.com',
    referralCode: 'LL-2026-006',
    status: 'PENDING',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-007',
    firstName: 'Kevin',
    lastName: 'Kintanar',
    dateOfBirth: '1991-06-27',
    age: 35,
    gender: 'Male',
    address: '21 Dona Soledad Ave, Parañaque City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 921 555 6677',
    email: 'kevin.kintanar@example.com',
    referralCode: 'KK-2026-007',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-008',
    firstName: 'Nina',
    lastName: 'Navarro',
    dateOfBirth: '1996-04-11',
    age: 30,
    gender: 'Female',
    address: '3 Sampaguita St, Cebu City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 922 666 7788',
    email: 'nina.navarro@example.com',
    referralCode: 'NN-2026-008',
    status: 'REJECTED',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-009',
    firstName: 'Oscar',
    lastName: 'Mendoza',
    dateOfBirth: '1988-07-30',
    age: 38,
    gender: 'Male',
    address: '321 Luna St, Quezon City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 920 456 7890',
    email: 'oscar.mendoza@example.com',
    referralCode: 'OM-2026-009',
    status: 'APPROVED_ACTIVE',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
  {
    id: 'mem-010',
    firstName: 'Pedro',
    lastName: 'Reyes',
    dateOfBirth: '1985-11-22',
    age: 40,
    gender: 'Male',
    address: '456 Bonifacio St, Cebu City',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+63 918 234 5678',
    email: 'pedro.reyes@example.com',
    referralCode: 'PR-2026-010',
    status: 'APPROVED_ACTIVE',
    isQualified: false,
    program: { id: 'prg-domestic', code: 'DOMESTIC', name: 'Domestic Program' },
  },
];

/** Re-export shared marketing content as MOCK_CONTENT for backward compatibility. */
export const MOCK_CONTENT = MOCK_MARKETING_CONTENT;

/** Mock programs (API-SPECIFICATION #78, FR-PRG-001). */
/** Program IDs match the web/member mock store (`prg-domestic`/`prg-abroad`) - single scheme. */
export const MOCK_PROGRAMS: Program[] = [
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
];

/** Mock ledger adjustments - PROPOSED shape for admin adjustment view. */
export type MockAdjustment = {
  id: string;
  memberId: string;
  memberName: string;
  entryType: 'FINANCIAL_ADJUSTMENT' | 'COMMISSION_REVERSAL' | 'WITHDRAWAL_REVERSAL';
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export const MOCK_ADJUSTMENTS: MockAdjustment[] = [
  {
    id: 'adj-001',
    memberId: 'mem-002',
    memberName: 'Maria Santos',
    entryType: 'FINANCIAL_ADJUSTMENT',
    direction: 'CREDIT',
    amount: '250.00',
    reason: 'Correction for missing referral credit on sale sal-002',
    createdBy: 'Ada Admin',
    createdAt: '2026-08-18T11:00:00.000Z',
  },
  {
    id: 'adj-002',
    memberId: 'mem-001',
    memberName: 'Juan Dela Cruz',
    entryType: 'COMMISSION_REVERSAL',
    direction: 'DEBIT',
    amount: '150.00',
    reason: 'Reversed commission for cancelled sale sal-005',
    createdBy: 'Fina Finance',
    createdAt: '2026-08-17T16:00:00.000Z',
  },
  {
    id: 'adj-003',
    memberId: 'mem-006',
    memberName: 'Liza Lopez',
    entryType: 'FINANCIAL_ADJUSTMENT',
    direction: 'CREDIT',
    amount: '100.00',
    reason: 'Promotional bonus credit - August campaign',
    createdBy: 'Saul Super',
    createdAt: '2026-08-16T09:30:00.000Z',
  },
];

/** Mock system configuration - PROPOSED key-value pairs. */
export type MockConfigEntry = {
  key: string;
  label: string;
  value: string;
  category: string;
};

export const MOCK_CONFIG: MockConfigEntry[] = [
  {
    key: 'COMMISSION_DIRECT_RATE',
    label: 'Direct Commission Rate',
    value: '0.0800',
    category: 'Commissions',
  },
  {
    key: 'COMMISSION_REFERRAL_RATE',
    label: 'Direct Referral Rate',
    value: '0.0400',
    category: 'Commissions',
  },
  {
    key: 'COMMISSION_CLEARING_DAYS',
    label: 'Commission Clearing Window (days)',
    value: '7',
    category: 'Commissions',
  },
  {
    key: 'MIN_WITHDRAWAL_AMOUNT',
    label: 'Minimum Withdrawal Amount',
    value: '100.00',
    category: 'Withdrawals',
  },
  {
    key: 'MAX_WITHDRAWAL_AMOUNT',
    label: 'Maximum Withdrawal Amount',
    value: '50000.00',
    category: 'Withdrawals',
  },
  {
    key: 'QUALIFICATION_MIN_SALES',
    label: 'Minimum Qualifying Sales',
    value: '1',
    category: 'Qualification',
  },
  {
    key: 'QUALIFICATION_MIN_AGE',
    label: 'Minimum Member Age',
    value: '18',
    category: 'Qualification',
  },
  {
    key: 'MAX_RESUBMISSION_ATTEMPTS',
    label: 'Max Sale Resubmission Attempts',
    value: '3',
    category: 'Sales',
  },
  {
    key: 'VOUCHER_DEFAULT_EXPIRY_DAYS',
    label: 'Voucher Expiry (days)',
    value: '90',
    category: 'Vouchers',
  },
  {
    key: 'GENDERS',
    label: 'Gender Options',
    value: '["Male","Female","Others"]',
    category: 'Registration',
  },
];

/** Roles - single MEMBER category, roles assigned via DB (member_roles). */
export type MockRole = {
  id: string;
  slug: string;
  name: string;
  description: string;
};

export const MOCK_ROLES: MockRole[] = [
  {
    id: 'role-001',
    slug: 'member_basic',
    name: 'Member',
    description: 'Base member - single category default',
  },
  {
    id: 'role-002',
    slug: 'member_qualified',
    name: 'Qualified',
    description: 'BR-QUAL-001 qualified',
  },
  { id: 'role-003', slug: 'admin', name: 'Admin', description: 'Member with admin capabilities' },
  {
    id: 'role-004',
    slug: 'finance',
    name: 'Finance',
    description: 'Member with finance capabilities',
  },
  {
    id: 'role-005',
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Staff SUPER_ADMIN - platform super user',
  },
];

/**
 * In-memory member → role slugs for F0 mock (mirrors member_roles join).
 * Qualified flags mirror member `isQualified`: mem-001/mem-005/mem-007.
 */
export const MOCK_MEMBER_ROLES: Record<string, string[]> = {
  'mem-001': ['member_basic', 'member_qualified'],
  'mem-002': ['member_basic'],
  'mem-003': ['member_basic'],
  'mem-004': ['member_basic'],
  'mem-005': ['member_basic', 'member_qualified'],
  'mem-006': ['member_basic'],
  'mem-007': ['member_basic', 'member_qualified'],
  'mem-008': ['member_basic'],
  'mem-009': ['member_basic'],
  'mem-010': ['member_basic'],
};

/**
 * Mock staff roster - PROPOSED shape for the admin Staff directory (RBAC
 * frontend pass). Exactly one staff role per user; status gates shell
 * access. Static mock; the real backend provisions staff operationally
 * (never seeded) and resolves roles server-side.
 */
export type MockStaffMember = {
  id: string;
  name: string;
  email: string;
  /** Exactly one role per staff member (system id or custom role id). */
  roleId: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  createdBy: string;
};

export const MOCK_STAFF: MockStaffMember[] = [
  {
    id: 'stf-001',
    name: 'Saul Super',
    email: 'superadmin@gmail.com',
    roleId: 'super_admin',
    status: 'ACTIVE',
    createdAt: '2026-07-01T09:00:00.000Z',
    createdBy: 'System',
  },
  {
    id: 'stf-002',
    name: 'Ada Admin',
    email: 'ada.admin@jad.example',
    roleId: 'admin',
    status: 'ACTIVE',
    createdAt: '2026-07-15T10:30:00.000Z',
    createdBy: 'Saul Super',
  },
  {
    id: 'stf-003',
    name: 'Ramon Cruz',
    email: 'ramon.cruz@jad.example',
    roleId: 'admin',
    status: 'ACTIVE',
    createdAt: '2026-08-02T14:00:00.000Z',
    createdBy: 'Saul Super',
  },
  {
    id: 'stf-004',
    name: 'Fina Finance',
    email: 'fina@jad.example',
    roleId: 'finance',
    status: 'ACTIVE',
    createdAt: '2026-07-20T11:15:00.000Z',
    createdBy: 'Saul Super',
  },
  {
    id: 'stf-005',
    name: 'Leo Tan',
    email: 'leo.tan@jad.example',
    roleId: 'finance',
    status: 'DISABLED',
    createdAt: '2026-07-22T09:45:00.000Z',
    createdBy: 'Saul Super',
  },
  {
    id: 'stf-006',
    name: 'Maya Merchant',
    email: 'maya.merchant@jad.example',
    roleId: 'merchant',
    status: 'ACTIVE',
    createdAt: '2026-08-05T13:20:00.000Z',
    createdBy: 'Ada Admin',
  },
  {
    id: 'stf-007',
    name: 'Paolo Reyes',
    email: 'paolo.reyes@jad.example',
    roleId: 'merchant',
    status: 'ACTIVE',
    createdAt: '2026-08-10T16:05:00.000Z',
    createdBy: 'Ada Admin',
  },
];

/** Mock audit log entries - PROPOSED shape. */
export type MockAuditEntry = {
  id: string;
  action: string;
  actor: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  targetName: string;
  detail: string;
  createdAt: string;
};

export const MOCK_AUDIT: MockAuditEntry[] = [
  {
    id: 'aud-001',
    action: 'REGISTRATION_APPROVED',
    actor: 'Ada Admin',
    actorRole: 'ADMIN',
    targetType: 'Registration',
    targetId: 'reg-002',
    targetName: 'Maria Santos',
    detail: 'Approved registration and activated member account',
    createdAt: '2026-08-18T08:45:00.000Z',
  },
  {
    id: 'aud-002',
    action: 'SALE_APPROVED',
    actor: 'Ada Admin',
    actorRole: 'ADMIN',
    targetType: 'Sale',
    targetId: 'sal-002',
    targetName: 'Prisma Residences - Celeste Building Condo - Juan Dela Cruz',
    detail: 'Approved sale submission for admin review',
    createdAt: '2026-08-17T10:15:00.000Z',
  },
  {
    id: 'aud-003',
    action: 'PAYOUT_CONFIRMED',
    actor: 'Fina Finance',
    actorRole: 'FINANCE',
    targetType: 'PayoutAccount',
    targetId: 'pac-003',
    targetName: 'Pedro Reyes - GCASH',
    detail: 'Confirmed payout account after verification',
    createdAt: '2026-08-16T09:20:00.000Z',
  },
  {
    id: 'aud-004',
    action: 'WITHDRAWAL_COMPLETED',
    actor: 'Fina Finance',
    actorRole: 'FINANCE',
    targetType: 'Withdrawal',
    targetId: 'wdr-005',
    targetName: '₱300.00 - Pedro Reyes',
    detail: 'Processed withdrawal payment via GCASH',
    createdAt: '2026-08-16T10:05:00.000Z',
  },
  {
    id: 'aud-005',
    action: 'ADJUSTMENT_CREATED',
    actor: 'Saul Super',
    actorRole: 'SUPER_ADMIN',
    targetType: 'Adjustment',
    targetId: 'adj-001',
    targetName: 'Maria Santos - ₱250.00 CREDIT',
    detail: 'Manual adjustment for missing referral credit',
    createdAt: '2026-08-18T11:05:00.000Z',
  },
  {
    id: 'aud-006',
    action: 'REGISTRATION_REJECTED',
    actor: 'Ada Admin',
    actorRole: 'ADMIN',
    targetType: 'Registration',
    targetId: 'reg-005',
    targetName: 'Ramon Garcia',
    detail: 'Rejected registration - documents require re-verification',
    createdAt: '2026-08-17T15:08:00.000Z',
  },
  {
    id: 'aud-007',
    action: 'CONFIG_UPDATED',
    actor: 'Saul Super',
    actorRole: 'SUPER_ADMIN',
    targetType: 'SystemConfig',
    targetId: 'COMMISSION_DIRECT_RATE',
    targetName: 'Direct Commission Rate',
    detail: 'Updated value from 0.0750 to 0.0800',
    createdAt: '2026-08-15T14:00:00.000Z',
  },
  {
    id: 'aud-008',
    action: 'CONTENT_PUBLISHED',
    actor: 'Ada Admin',
    actorRole: 'ADMIN',
    targetType: 'Content',
    targetId: 'ctn-003',
    targetName: 'JA&D Project Showcase',
    detail: 'Published promotional content for member forwarding',
    createdAt: '2026-08-08T10:05:00.000Z',
  },
  {
    id: 'aud-009',
    action: 'SALE_RESUBMISSION_EXCEEDED',
    actor: 'System',
    actorRole: 'SYSTEM',
    targetType: 'Sale',
    targetId: 'sal-006',
    targetName: 'Prisma Residences - Celeste Building Condo - Celine Cruz',
    detail: 'Maximum resubmission attempts exceeded (BR-SAL-006)',
    createdAt: '2026-08-13T10:30:00.000Z',
  },
  {
    id: 'aud-010',
    action: 'SALE_LOCKED',
    actor: 'System',
    actorRole: 'SYSTEM',
    targetType: 'Sale',
    targetId: 'sal-006',
    targetName: 'Prisma Residences - Celeste Building Condo - Celine Cruz',
    detail: 'Locked after 3 failed verification attempts',
    createdAt: '2026-08-13T14:00:00.000Z',
  },
  {
    id: 'aud-011',
    action: 'REGISTRATION_VERIFICATION_FAILED',
    actor: 'System',
    actorRole: 'SYSTEM',
    targetType: 'Registration',
    targetId: 'reg-005',
    targetName: 'Ramon Garcia',
    detail: 'Rejected registration - documents require re-verification',
    createdAt: '2026-08-17T15:10:00.000Z',
  },
  {
    id: 'aud-012',
    action: 'REGISTRATION_VERIFICATION_FAILED',
    actor: 'System',
    actorRole: 'SYSTEM',
    targetType: 'Registration',
    targetId: 'reg-012',
    targetName: 'Elena Navarro',
    detail: 'Rejected registration - identity verification failed',
    createdAt: '2026-08-15T12:15:00.000Z',
  },
];
