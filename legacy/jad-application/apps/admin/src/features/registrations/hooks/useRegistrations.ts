import { useQuery } from '@tanstack/react-query';

import { getRegistrations, getRegistrationsPage } from '../repositories/registrationRepository';

export function useRegistrations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'registrations'],
    queryFn: getRegistrations,
    enabled: options?.enabled ?? true,
  });
}

/** Queue page query - list plus the server's hidden-row (`meta.invalid`) count. */
export function useRegistrationsPage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'registrations', 'page'],
    queryFn: getRegistrationsPage,
    enabled: options?.enabled ?? true,
  });
}
