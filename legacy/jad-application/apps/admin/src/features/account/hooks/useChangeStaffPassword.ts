import { useMutation } from '@tanstack/react-query';

import { changeStaffPassword } from '../services/account';

export function useChangeStaffPassword() {
  return useMutation({ mutationFn: changeStaffPassword });
}
