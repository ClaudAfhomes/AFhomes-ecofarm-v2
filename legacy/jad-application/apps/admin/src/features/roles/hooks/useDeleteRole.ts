import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteRole } from '../services/roles';

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRole,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}
