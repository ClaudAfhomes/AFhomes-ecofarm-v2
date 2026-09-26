import { BottomNav } from '@jad/ui';

import { memberBottomNavItems } from '../navigation';

interface MemberBottomNavProps {
  onMore: () => void;
}

/**
 * Mobile bottom navigation (UI-UX §4.6): the 5 most frequent destinations plus
 * a "More" affordance that opens the full navigation drawer.
 */
export function MemberBottomNav({ onMore }: MemberBottomNavProps) {
  return <BottomNav items={memberBottomNavItems()} moreItem={{ label: 'More', onClick: onMore }} />;
}
