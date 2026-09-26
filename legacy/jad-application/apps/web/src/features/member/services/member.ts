import { z } from 'zod';
import {
  commissionSchema,
  conversationSummarySchema,
  customerSchema,
  directReferralSchema,
  forwardableContentSchema,
  genealogySchema,
  groupNetworkSchema,
  ledgerEntrySchema,
  markMessagesReadResponseSchema,
  markNotificationReadResponseSchema,
  memberProfileSchema,
  messageSchema,
  notificationSchema,
  payoutAccountSchema,
  qualificationSummarySchema,
  readAllNotificationsResponseSchema,
  referralCodeSchema,
  reopenSaleRequestResponseSchema,
  saleSchema,
  voucherSchema,
  walletSchema,
  withdrawalSchema,
} from '@jad/contracts';
import type {
  Commission,
  ConversationSummary,
  CreateCustomerRequest,
  CreateMessageRequest,
  CreatePayoutAccountRequest,
  CreateWithdrawalRequest,
  Customer,
  DirectReferral,
  ForwardableContent,
  Genealogy,
  GroupNetwork,
  LedgerEntry,
  MarkMessagesReadResponse,
  MarkNotificationReadResponse,
  MemberProfile,
  Message,
  Notification,
  PayoutAccount,
  QualificationSummary,
  ReadAllNotificationsResponse,
  ReferralCode,
  ReopenSaleRequestResponse,
  Sale,
  SubmitSaleRequest,
  UpdateProfileRequest,
  Voucher,
  Wallet,
  Withdrawal,
} from '@jad/contracts';

import { request, requestList, requestPage } from '../../../lib/api/client';
import type { PageResult } from '../../../lib/api/client';

/**
 * Member portal services (SCR-MEM-001..007) - typed wrappers over the API
 * client. All endpoints are MEMBER-scoped; authorization is enforced server-side
 * (object-level, NFR-AUTHZ-002) - the client never bypasses it.
 */

/** `GET /members/:id` - own profile (API-SPECIFICATION #8). */
export function getProfile(memberId: string): Promise<MemberProfile> {
  return request(`/members/${memberId}`, memberProfileSchema);
}

/** `PATCH /me` - mutable profile fields; country immutable (BR-REG-010). */
export function updateProfile(input: UpdateProfileRequest): Promise<MemberProfile> {
  return request('/me', memberProfileSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `GET /me/wallet` - eWallet summary (API-SPECIFICATION #43). */
export function getWallet(): Promise<Wallet> {
  return request('/me/wallet', walletSchema);
}

/** `GET /me/qualification` - server-authoritative checklist (API-SPECIFICATION #15). */
export function getQualification(): Promise<QualificationSummary> {
  return request('/me/qualification', qualificationSummarySchema);
}

/** `GET /me/referral-code` - immutable referral code (API-SPECIFICATION #14). */
export function getReferralCode(): Promise<ReferralCode> {
  return request('/me/referral-code', referralCodeSchema);
}

/** `GET /me/broadcasts` - member notification feed (API-SPECIFICATION #73). */
export function getBroadcasts(): Promise<Notification[]> {
  return requestList('/me/broadcasts', notificationSchema);
}

/** `POST /me/broadcasts/:id/read` - per-member read receipt (idempotent). */
export function markNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResponse> {
  return request(`/me/broadcasts/${notificationId}/read`, markNotificationReadResponseSchema, {
    method: 'POST',
  });
}

/** `GET /me/broadcasts/read-all` - receipts for every visible unread item. */
export function markAllNotificationsRead(): Promise<ReadAllNotificationsResponse> {
  return request('/me/broadcasts/read-all', readAllNotificationsResponseSchema, {
    method: 'POST',
  });
}

/** `GET /me/messages?cursor=…` - own admin thread, cursor-paginated newest first (API-SPECIFICATION #90). */
export function getMessagesPage(cursor?: string, limit?: number): Promise<PageResult<Message>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit) params.set('limit', String(limit));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return requestPage(`/me/messages${query}`, messageSchema);
}

/** `POST /me/messages` - send a message to the admin team (API-SPECIFICATION #91). */
export function sendMessage(input: CreateMessageRequest): Promise<Message> {
  return request('/me/messages', messageSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `POST /me/messages/read` - mark the thread read (API-SPECIFICATION #92). */
export function markMessagesRead(): Promise<MarkMessagesReadResponse> {
  return request('/me/messages/read', markMessagesReadResponseSchema, {
    method: 'POST',
  });
}

/** `GET /me/messages/summary` - thread badge: unread staff replies (API-SPECIFICATION #93). */
export function getMessagesSummary(): Promise<ConversationSummary> {
  return request('/me/messages/summary', conversationSummarySchema);
}

/** `GET /customers` - the member's own customer records (API-SPECIFICATION #23). */
export function getCustomers(): Promise<Customer[]> {
  return requestList('/customers', customerSchema);
}

/** `POST /customers` - add a customer record (API-SPECIFICATION #24, FR-CUS-001). */
export function createCustomer(input: CreateCustomerRequest): Promise<Customer> {
  return request('/customers', customerSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `GET /sales` - the member's own sales, newest first (API-SPECIFICATION #31). */
export function getSales(): Promise<Sale[]> {
  return requestList('/sales', saleSchema);
}

/** `GET /sales/:id` - one of the member's own sales (API-SPECIFICATION #32). */
export function getSale(saleId: string): Promise<Sale> {
  return request(`/sales/${saleId}`, saleSchema);
}

/**
 * `POST /sales` - submit a qualifying sale (API-SPECIFICATION #30, §7.1).
 * Requires `Idempotency-Key` (API-SPECIFICATION §5.3); the client holds the key
 * for the submission attempt so retries are safe, but never persists it.
 */
export function submitSale(input: SubmitSaleRequest, idempotencyKey: string): Promise<Sale> {
  return request('/sales', saleSchema, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** `POST /sales/:id/resubmit` - corrected sale re-enters approval (API-SPECIFICATION #36). */
export function resubmitSale(
  saleId: string,
  input: SubmitSaleRequest,
  idempotencyKey: string,
): Promise<Sale> {
  return request(`/sales/${saleId}/resubmit`, saleSchema, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** `POST /me/sales/:id/reopen-request` - request staff review of a LOCKED sale (#89 PROPOSED). */
export function requestReopenSale(saleId: string): Promise<ReopenSaleRequestResponse> {
  return request(`/me/sales/${saleId}/reopen-request`, reopenSaleRequestResponseSchema, {
    method: 'POST',
  });
}

/** `GET /me/commissions` - own commissions incl. status (API-SPECIFICATION #39, SCR-MEM-015). */
export function getCommissions(): Promise<Commission[]> {
  return requestList('/me/commissions', commissionSchema);
}

/** `GET /me/payout-accounts` - own payout accounts (API-SPECIFICATION #48, SCR-MEM-010). */
export function getPayoutAccounts(): Promise<PayoutAccount[]> {
  return requestList('/me/payout-accounts', payoutAccountSchema);
}

/** `POST /me/payout-accounts` - add a payout account (API-SPECIFICATION #49, SCR-MEM-011). */
export function createPayoutAccount(input: CreatePayoutAccountRequest): Promise<PayoutAccount> {
  return request('/me/payout-accounts', payoutAccountSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /me/payout-accounts/:id` - designate the single Primary (API-SPECIFICATION #50, BR-PAY-006). */
export function setPrimaryPayoutAccount(accountId: string): Promise<PayoutAccount> {
  return request(`/me/payout-accounts/${accountId}`, payoutAccountSchema, {
    method: 'PATCH',
    body: JSON.stringify({ isPrimary: true }),
  });
}

/** `DELETE /me/payout-accounts/:id` - delete a pending account (typo remediation, PENDING only). */
export function deletePayoutAccount(accountId: string): Promise<{ deleted: boolean }> {
  return request(`/me/payout-accounts/${accountId}`, z.object({ deleted: z.boolean() }), {
    method: 'DELETE',
  });
}

/** `GET /me/withdrawals` - own withdrawals (API-SPECIFICATION #55, SCR-MEM-013). */
export function getWithdrawals(): Promise<Withdrawal[]> {
  return requestList('/me/withdrawals', withdrawalSchema);
}

/** `GET /me/withdrawals/:id` - one of the member's own withdrawals (API-SPECIFICATION #56, SCR-MEM-014). */
export function getWithdrawal(withdrawalId: string): Promise<Withdrawal> {
  return request(`/me/withdrawals/${withdrawalId}`, withdrawalSchema);
}

/**
 * `POST /me/withdrawals` - request a withdrawal (API-SPECIFICATION #54, §7.2).
 * Requires `Idempotency-Key` (API-SPECIFICATION §5.3); the client holds the key
 * for the attempt and reuses it on retry so replays never double-reserve, and
 * never persists it.
 */
export function createWithdrawal(
  input: CreateWithdrawalRequest,
  idempotencyKey: string,
): Promise<Withdrawal> {
  return request('/me/withdrawals', withdrawalSchema, {
    method: 'POST',
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

/** `GET /me/ledger?cursor=…` - cursor-paginated ledger page (API-SPECIFICATION #44, §4). */
export function getLedgerPage(
  cursor?: string,
  type?: string,
  limit?: number,
): Promise<PageResult<LedgerEntry>> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (type) params.set('type', type);
  if (limit) params.set('limit', String(limit));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return requestPage(`/me/ledger${query}`, ledgerEntrySchema);
}

/** `GET /me/direct-referrals` - single-level list (API-SPECIFICATION #22/#74, SCR-MEM-016). */
export function getDirectReferrals(): Promise<DirectReferral[]> {
  return requestList('/me/direct-referrals', directReferralSchema);
}

/** `GET /me/reports/group-network` - network summary, reporting only (API-SPECIFICATION #75, SCR-MEM-017). */
export function getGroupNetwork(): Promise<GroupNetwork> {
  return request('/me/reports/group-network', groupNetworkSchema);
}

/** `GET /me/genealogy` - referral tree visualization, no MLM (API-SPECIFICATION #77, SCR-MEM-018). */
export function getGenealogy(): Promise<Genealogy> {
  return request('/me/genealogy', genealogySchema);
}

/** `GET /me/vouchers` - own vouchers (API-SPECIFICATION #61, SCR-MEM-020). */
export function getVouchers(): Promise<Voucher[]> {
  return requestList('/me/vouchers', voucherSchema);
}

/** `GET /vouchers/:id` - one of the member's own vouchers (API-SPECIFICATION #62, SCR-MEM-021). */
export function getVoucher(voucherId: string): Promise<Voucher> {
  return request(`/vouchers/${voucherId}`, voucherSchema);
}

/** `GET /content/forwardable` - permitted shareable/downloadable content (API-SPECIFICATION #68, SCR-MEM-022). */
export function getContentLibrary(): Promise<ForwardableContent[]> {
  return requestList('/content/forwardable', forwardableContentSchema);
}
