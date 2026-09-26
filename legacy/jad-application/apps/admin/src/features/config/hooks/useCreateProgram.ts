import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProgramCreateRequest } from '@jad/contracts';

import { createProgram } from '../services/config';

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProgramCreateRequest) => createProgram(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'programs'] });
      qc.invalidateQueries({ queryKey: ['admin', 'config', 'programs'] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });
}
