import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateCategory, type UpdateCategoryInput } from '../services/catalog';

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, input }: { slug: string; input: UpdateCategoryInput }) =>
      updateCategory(slug, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
    },
  });
}
