import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createCategory, type CreateCategoryInput } from '../services/catalog';

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) => createCategory(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
    },
  });
}
