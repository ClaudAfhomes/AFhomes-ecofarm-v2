import { useMutation, useQueryClient } from '@tanstack/react-query';

import { assignStaffRole } from '../services/staff';

export function useAssignStaffRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assignStaffRole,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
}
