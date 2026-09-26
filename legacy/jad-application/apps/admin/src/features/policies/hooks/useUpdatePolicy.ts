import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PolicyUpdateRequest } from '@jad/contracts';

import { updatePolicy } from '../services/policies';

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PolicyUpdateRequest }) =>
      updatePolicy(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'policies'] });
    },
  });
}
