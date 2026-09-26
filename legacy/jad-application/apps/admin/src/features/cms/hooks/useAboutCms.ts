import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAbout, updateAbout } from '../services/cmsRepository';
import type { AboutContent } from '@jad/contracts';

export function useAboutCms() {
  return useQuery<AboutContent>({
    queryKey: ['cms', 'about'],
    queryFn: getAbout,
  });
}

export function useUpdateAboutCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: AboutContent) => updateAbout(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'about'], data);
    },
  });
}
