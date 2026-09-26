import type { StaffModule } from '@jad/contracts';

/** Module checkbox groups mirroring the sidebar categories. */
export const MODULE_GROUPS: { label: string; modules: StaffModule[] }[] = [
  { label: 'Dashboard', modules: ['dashboard'] },
  { label: 'Members', modules: ['registrations', 'members'] },
  { label: 'Operations', modules: ['sales', 'payouts', 'withdrawals', 'vouchers'] },
  { label: 'Properties & Content', modules: ['properties', 'marketing_tools'] },
  { label: 'Communications', modules: ['messages'] },
  { label: 'System', modules: ['config', 'programs', 'audit', 'staff'] },
  { label: 'Website CMS', modules: ['cms'] },
];
