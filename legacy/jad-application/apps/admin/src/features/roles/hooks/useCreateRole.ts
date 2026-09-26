import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createRole } from '../services/roles';

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}
