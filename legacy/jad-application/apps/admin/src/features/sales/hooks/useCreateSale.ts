import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createSale, type CreateSaleInput } from '../repositories/salesRepository';

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSaleInput) => createSale(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'sales'] });
    },
  });
}
