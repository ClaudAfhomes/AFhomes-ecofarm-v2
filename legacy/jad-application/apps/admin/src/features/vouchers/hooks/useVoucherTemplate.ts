import { useQuery } from '@tanstack/react-query';

import type { VoucherTemplate } from '@jad/contracts';

import { ApiError } from '../../../lib/api/errors';
import { getVoucherTemplate } from '../services/vouchers';

export function useVoucherTemplate(id: string) {
  return useQuery({
    queryKey: ['admin', 'vouchers', 'template', id],
    queryFn: async (): Promise<VoucherTemplate | undefined> => {
      try {
        return await getVoucherTemplate(id);
      } catch (e) {
        // Role-denied readers see "not found" rather than a broken page.
        if (e instanceof ApiError && e.status === 403) return undefined;
        throw e;
      }
    },
    enabled: id.length > 0,
  });
}
