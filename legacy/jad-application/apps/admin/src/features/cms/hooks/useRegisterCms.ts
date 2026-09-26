import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getRegister, updateRegister } from '../services/cmsRepository';
import type { RegisterContent } from '@jad/contracts';

export function useRegisterCms() {
  return useQuery<RegisterContent>({
    queryKey: ['cms', 'register'],
    queryFn: getRegister,
  });
}

export function useUpdateRegisterCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: RegisterContent) => updateRegister(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'register'], data);
    },
  });
}
