import { useQuery } from '@tanstack/react-query';

import { getRegistrationById } from '../repositories/registrationRepository';

export function useRegistration(id: string) {
  return useQuery({
    queryKey: ['admin', 'registration', id],
    queryFn: () => getRegistrationById(id),
    enabled: Boolean(id),
  });
}
