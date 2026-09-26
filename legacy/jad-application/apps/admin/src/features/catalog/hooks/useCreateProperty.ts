import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createProperty, type CreatePropertyInput } from '../services/catalog';

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePropertyInput) => createProperty(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
      qc.invalidateQueries({ queryKey: ['cms', 'properties'] });
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
    },
  });
}
