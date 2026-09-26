import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createContent, type CreateContentInput } from '../services/content';

export function useCreateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContentInput) => createContent(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'content'] });
    },
  });
}
