import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateContentItemRequest } from '@jad/contracts';

import { updateContentItem } from '../services/content';

export function useUpdateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContentItemRequest }) =>
      updateContentItem(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'content'] });
    },
  });
}
