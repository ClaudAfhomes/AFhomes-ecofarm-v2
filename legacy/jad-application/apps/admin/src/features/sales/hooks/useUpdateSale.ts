import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Sale } from '@jad/contracts';

import { updateSale } from '../repositories/salesRepository';

export function useUpdateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<Sale, 'id' | 'submittedAt'>> }) =>
      updateSale(id, patch),
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'sales'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'sale', vars.id] });
    },
  });
}
