import { useQuery } from '@tanstack/react-query';

import { emptyOnForbidden } from '../../../lib/api/errors';
import { getVoucherTemplates } from '../services/vouchers';

/** Voucher definitions - the "Create Voucher" list. */
export function useVouchers() {
  return useQuery({
    queryKey: ['admin', 'vouchers'],
    queryFn: () => emptyOnForbidden(() => getVoucherTemplates()),
  });
}
