import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateConfig } from '../services/config';

/** Persist a config value via PATCH /admin/config/:key; refreshes the config list. */
export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateConfig(key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
  });
}
