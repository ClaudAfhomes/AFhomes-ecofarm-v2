import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateProperty, type UpdatePropertyInput } from '../services/catalog';

export function useUpdateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePropertyInput }) =>
      updateProperty(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
      qc.invalidateQueries({ queryKey: ['cms', 'properties'] });
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
    },
  });
}
