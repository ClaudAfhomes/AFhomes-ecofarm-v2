import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteContentItem } from '../services/content';

export function useDeleteContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContentItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'content'] });
    },
  });
}
