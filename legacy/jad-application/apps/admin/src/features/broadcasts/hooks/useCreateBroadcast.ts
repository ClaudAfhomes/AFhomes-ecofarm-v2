import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createBroadcast } from '../services/broadcasts';

export function useCreateBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBroadcast,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'broadcasts'] });
    },
  });
}
