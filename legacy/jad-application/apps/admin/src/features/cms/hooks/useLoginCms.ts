import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getLogin, updateLogin } from '../services/cmsRepository';
import type { LoginContent } from '@jad/contracts';

export function useLoginCms() {
  return useQuery<LoginContent>({
    queryKey: ['cms', 'login'],
    queryFn: getLogin,
  });
}

export function useUpdateLoginCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: LoginContent) => updateLogin(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'login'], data);
    },
  });
}
