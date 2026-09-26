import { useMutation } from '@tanstack/react-query';

import { scanVoucher } from '../services/vouchers';

/** Resolve a QR code (verify-only). No cache invalidation - scan is stateless. */
export function useScanVoucher() {
  return useMutation({
    mutationFn: (code: string) => scanVoucher(code),
  });
}
