import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createVoucher, type CreateVoucherInput } from '../services/vouchers';

export function useCreateVoucher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVoucherInput) => createVoucher(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] }),
  });
}
