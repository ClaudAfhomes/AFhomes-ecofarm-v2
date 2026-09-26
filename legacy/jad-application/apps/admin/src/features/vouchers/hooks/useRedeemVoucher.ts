import { useMutation, useQueryClient } from '@tanstack/react-query';

import { redeemVoucher } from '../services/vouchers';

export function useRedeemVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => redeemVoucher(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
    },
  });
}
