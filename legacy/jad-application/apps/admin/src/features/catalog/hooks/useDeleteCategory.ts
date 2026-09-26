import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteCategory } from '../services/catalog';

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => deleteCategory(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
    },
  });
}
