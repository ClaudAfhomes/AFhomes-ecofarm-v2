import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getHomepage, updateHomepage } from '../services/cmsRepository';
import type { HomepageContent } from '@jad/contracts';

export function useHomepageCms() {
  return useQuery<HomepageContent>({
    queryKey: ['cms', 'homepage'],
    queryFn: getHomepage,
  });
}

export function useUpdateHomepageCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: HomepageContent) => updateHomepage(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'homepage'], data);
    },
  });
}
