import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteVoucher } from '../services/vouchers';

export function useDeleteVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVoucher(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] }),
  });
}
