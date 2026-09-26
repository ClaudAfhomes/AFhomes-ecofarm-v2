import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getFaqs, updateFaqs } from '../services/cmsRepository';
import type { FaqContent } from '@jad/contracts';

export function useFaqsCms() {
  return useQuery<FaqContent>({
    queryKey: ['cms', 'faqs'],
    queryFn: getFaqs,
  });
}

export function useUpdateFaqsCms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: FaqContent) => updateFaqs(draft),
    onSuccess: (data) => {
      qc.setQueryData(['cms', 'faqs'], data);
    },
  });
}
