import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setStaffStatus } from '../services/staff';

export function useSetStaffStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setStaffStatus,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'staff'] });
    },
  });
}
