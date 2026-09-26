import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createStaff } from '../services/staff';

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createStaff,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
}
