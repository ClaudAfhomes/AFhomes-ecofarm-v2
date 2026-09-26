import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deletePolicy } from '../services/policies';

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePolicy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
    },
  });
}
