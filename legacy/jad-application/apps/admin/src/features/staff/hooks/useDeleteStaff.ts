import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteStaff } from '../services/staff';

export function useDeleteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteStaff,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
}
