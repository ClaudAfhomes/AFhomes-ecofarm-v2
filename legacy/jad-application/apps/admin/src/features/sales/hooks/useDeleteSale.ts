import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteSale } from '../repositories/salesRepository';

export function useDeleteSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSale(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'sales'] });
    },
  });
}
