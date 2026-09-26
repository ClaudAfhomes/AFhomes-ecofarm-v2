import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteProperty } from '../services/catalog';

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProperty(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'properties'] });
      qc.invalidateQueries({ queryKey: ['cms', 'properties'] });
      qc.invalidateQueries({ queryKey: ['admin', 'property-categories'] });
    },
  });
}
