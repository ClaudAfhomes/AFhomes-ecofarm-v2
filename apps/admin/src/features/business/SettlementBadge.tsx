import { StatusChip } from '@afhomes/ui';

import { SETTLEMENT_TONE, settlementStatus } from './format';

/**
 * Settlement badge: green Fully Paid when Total equals Paid and Balance is
 * zero, orange Unsettled otherwise. The tone map lives beside the rule so
 * color can never disagree with the words.
 */
export function SettlementBadge({
  total,
  paid,
  balance,
}: {
  total: string | null | undefined;
  paid: string | null | undefined;
  balance?: string | null;
}) {
  const settlement = settlementStatus(total, paid, balance);
  return <StatusChip label={settlement} tone={SETTLEMENT_TONE[settlement]} />;
}
