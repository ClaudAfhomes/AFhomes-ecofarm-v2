import type { AfHomesModuleKey } from '@afhomes/contracts';

import { useSession } from '../../lib/session';

/** UX-only: the server re-checks every action. */
export function useModuleAccess(moduleKey: AfHomesModuleKey) {
  const permission = useSession().user?.afHomesPermissions?.find((p) => p.moduleKey === moduleKey);
  return {
    canView: permission?.canView === true,
    canCreate: permission?.canCreate === true,
    canUpdate: permission?.canUpdate === true,
  };
}

/** Today in Philippine time as YYYY-MM-DD (the date bookings are judged against). */
export const todayInManila = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Try again.');
