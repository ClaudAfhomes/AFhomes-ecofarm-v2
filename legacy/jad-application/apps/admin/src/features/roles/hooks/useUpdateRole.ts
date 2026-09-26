import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateRole } from '../services/roles';

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateRole,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
}
