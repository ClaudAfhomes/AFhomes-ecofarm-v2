import { useMutation } from '@tanstack/react-query';

import { updateStaffProfile } from '../services/account';

export function useUpdateStaffProfile() {
  return useMutation({ mutationFn: updateStaffProfile });
}
