import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '../../../lib/session';

import {
  getBroadcasts,
  getCommissions,
  getContentLibrary,
  getCustomers,
  getDirectReferrals,
  getGenealogy,
  getGroupNetwork,
  getLedgerPage,
  getMessagesPage,
  getMessagesSummary,
  getPayoutAccounts,
  getProfile,
  getQualification,
  getReferralCode,
  getSale,
  getSales,
  getVoucher,
  getVouchers,
  getWallet,
  getWithdrawal,
  getWithdrawals,
  markMessagesRead,
  sendMessage,
} from '../services/member';

/** `GET /members/:id` - the signed-in member's profile (SCR-MEM-002). */
export function useMemberProfile() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'profile', user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/wallet` - eWallet summary (SCR-MEM-001). */
export function useWallet() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'wallet', user?.id],
    queryFn: getWallet,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/ledger` - append-only ledger, cursor-paginated (SCR-MEM-009, API-SPECIFICATION §4). */
export function useLedgerPage(type: string) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: ['member', 'ledger', 'page', type, user?.id],
    queryFn: ({ pageParam }) => getLedgerPage(pageParam as string | undefined, type || undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/commissions` - own commissions (SCR-MEM-015). */
export function useCommissions() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'commissions', user?.id],
    queryFn: getCommissions,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/payout-accounts` - own payout accounts (SCR-MEM-010). */
export function usePayoutAccounts() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'payout-accounts', user?.id],
    queryFn: getPayoutAccounts,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/withdrawals` - own withdrawals (SCR-MEM-013). */
export function useWithdrawals() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'withdrawals', user?.id],
    queryFn: getWithdrawals,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/withdrawals/:id` - one withdrawal (SCR-MEM-014). */
export function useWithdrawal(withdrawalId: string) {
  return useQuery({
    queryKey: ['member', 'withdrawals', withdrawalId],
    queryFn: () => getWithdrawal(withdrawalId),
    enabled: withdrawalId.length > 0,
  });
}

/** `GET /me/qualification` - server-authoritative checklist (SCR-MEM-004). */
export function useQualification() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'qualification', user?.id],
    queryFn: getQualification,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/referral-code` - immutable referral code (SCR-MEM-003). */
export function useReferralCode() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'referral-code', user?.id],
    queryFn: getReferralCode,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/broadcasts` - member notification feed (SCR-MEM-024). API is
 * the only read path (no direct Supabase table reads); live inserts arrive
 * via `useNotificationsRealtime`, mounted once in `MemberLayout`. */
export function useBroadcasts() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'broadcasts', user?.id],
    queryFn: getBroadcasts,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/messages` - own admin thread, cursor-paginated (FEAT-072). */
export function useMessagesPage() {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: ['member', 'messages', user?.id],
    queryFn: ({ pageParam }) => getMessagesPage(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/messages/summary` - thread badge (unread staff replies). */
export function useMessagesSummary() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'messages', 'summary', user?.id],
    queryFn: getMessagesSummary,
    enabled: Boolean(user?.id),
  });
}

/** `POST /me/messages` + `POST /me/messages/read` - send and mark-read. */
export function useSendMessage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const baseKey = ['member', 'messages', user?.id] as const;
  return useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', 'messages', 'summary', user?.id] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: baseKey });
    },
  });
}

export function useMarkMessagesRead() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const summaryKey = ['member', 'messages', 'summary', user?.id] as const;
  return useMutation({
    mutationFn: markMessagesRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: summaryKey });
    },
  });
}

/** `GET /customers` - the member's own customer records (SCR-MEM-006). */
export function useCustomers() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'customers', user?.id],
    queryFn: getCustomers,
    enabled: Boolean(user?.id),
  });
}

/** `GET /sales` - the member's own sales (SCR-MEM-005). */
export function useSales() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'sales', user?.id],
    queryFn: getSales,
    enabled: Boolean(user?.id),
  });
}

/** `GET /sales/:id` - one of the member's own sales (SCR-MEM-007). */
export function useSale(saleId: string) {
  return useQuery({
    queryKey: ['member', 'sales', saleId],
    queryFn: () => getSale(saleId),
    enabled: saleId.length > 0,
  });
}

/** `GET /me/direct-referrals` - direct referrals (SCR-MEM-016, reporting only). */
export function useDirectReferrals() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'direct-referrals', user?.id],
    queryFn: getDirectReferrals,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/reports/group-network` - network summary (SCR-MEM-017, reporting only). */
export function useGroupNetwork() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'group-network', user?.id],
    queryFn: getGroupNetwork,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/genealogy` - referral tree (SCR-MEM-018, no MLM). */
export function useGenealogy() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'genealogy', user?.id],
    queryFn: getGenealogy,
    enabled: Boolean(user?.id),
  });
}

/** `GET /me/vouchers` - own vouchers (SCR-MEM-020). */
export function useVouchers() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['member', 'vouchers', user?.id],
    queryFn: getVouchers,
    enabled: Boolean(user?.id),
  });
}

/** `GET /vouchers/:id` - one of the member's own vouchers (SCR-MEM-021). */
export function useVoucher(voucherId: string) {
  return useQuery({
    queryKey: ['member', 'vouchers', voucherId],
    queryFn: () => getVoucher(voucherId),
    enabled: voucherId.length > 0,
  });
}

/** `GET /content/forwardable` - content library (SCR-MEM-022, FR-ADM-003). */
export function useContentLibrary() {
  return useQuery({
    queryKey: ['member', 'content-library'],
    queryFn: () => getContentLibrary(),
  });
}
