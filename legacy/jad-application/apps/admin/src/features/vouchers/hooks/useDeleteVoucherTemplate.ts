import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteVoucherTemplate } from '../services/vouchers';

/** DELETE /admin/voucher-templates/:id - remove a definition and its assignments. */
export function useDeleteVoucherTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVoucherTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers', 'assignments'] });
    },
  });
}
