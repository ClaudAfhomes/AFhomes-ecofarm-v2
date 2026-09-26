import { useMutation, useQueryClient } from '@tanstack/react-query';

import { assignVoucher, type AssignVoucherInput } from '../services/vouchers';

export function useAssignVoucher(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignVoucherInput) => assignVoucher(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers', templateId, 'assignments'] });
    },
  });
}
