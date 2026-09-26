import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProgramUpdateRequest } from '@jad/contracts';

import { updateProgram } from '../services/config';

export function useUpdateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProgramUpdateRequest }) =>
      updateProgram(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'programs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'config', 'programs'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
}
