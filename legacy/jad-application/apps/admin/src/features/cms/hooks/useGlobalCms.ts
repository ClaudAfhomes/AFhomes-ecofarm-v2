import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getGlobal, updateGlobal } from '../services/cmsRepository';
import type { GlobalContent } from '@jad/contracts';

export function useGlobalCms() {
  return useQuery<GlobalContent>({
    queryKey: ['cms', 'global'],
    queryFn: getGlobal,
  });
}

export function useUpdateGlobalCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: GlobalContent) => updateGlobal(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'global'], data);
    },
  });
}
