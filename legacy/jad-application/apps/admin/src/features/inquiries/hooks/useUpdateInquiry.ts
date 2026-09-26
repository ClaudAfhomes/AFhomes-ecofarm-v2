import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ContactInquiryStatus } from '@jad/contracts';

import { updateInquiry } from '../services/inquiries';

export function useUpdateInquiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContactInquiryStatus }) =>
      updateInquiry(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'inquiries'] });
    },
  });
}
