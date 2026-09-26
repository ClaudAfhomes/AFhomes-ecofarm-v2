import { useQuery } from '@tanstack/react-query';

import { getRegistrationById } from '../../registrations/repositories/registrationRepository';

/**
 * Linked application for a member (via Member.registrationId). Disabled
 * when the member was created directly and has no application on file.
 */
export function useMemberRegistration(registrationId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'member-registration', registrationId],
    queryFn: () => getRegistrationById(registrationId as string),
    enabled: Boolean(registrationId),
  });
}
