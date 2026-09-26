import { useQuery } from '@tanstack/react-query';

import { emptyOnForbidden } from '../../../lib/api/errors';
import { getAllVoucherAssignments, getVoucherAssignments } from '../services/vouchers';

/** Member-scoped vouchers assigned to one voucher definition. */
export function useVoucherAssignments(templateId: string) {
  return useQuery({
    queryKey: ['admin', 'vouchers', templateId, 'assignments'],
    queryFn: () => emptyOnForbidden(() => getVoucherAssignments(templateId)),
    enabled: templateId.length > 0,
  });
}

/** All member-scoped vouchers across definitions - backs per-definition counts. */
export function useAllVoucherAssignments() {
  return useQuery({
    queryKey: ['admin', 'vouchers', 'assignments'],
    queryFn: () => emptyOnForbidden(() => getAllVoucherAssignments()),
  });
}
