import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateVoucherTemplateRequest } from '@jad/contracts';

import { updateVoucherTemplate } from '../services/vouchers';

/** PATCH /admin/voucher-templates/:id - edit a voucher definition. */
export function useUpdateVoucherTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateVoucherTemplateRequest) => updateVoucherTemplate(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers'] });
      qc.invalidateQueries({ queryKey: ['admin', 'vouchers', 'template', id] });
    },
  });
}
