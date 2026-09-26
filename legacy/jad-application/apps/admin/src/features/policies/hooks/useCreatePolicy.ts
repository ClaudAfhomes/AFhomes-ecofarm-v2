import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createPolicy } from '../services/policies';

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPolicy,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
    },
  });
}
