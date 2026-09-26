import { NavLink } from 'react-router';
import type { NavLinkProps } from 'react-router';

/**
 * Navigation link for public routes.
 * Scroll reset is handled centrally by <ScrollToTop /> in App.
 * This component delegates directly to React Router's NavLink.
 */
export function PublicNavLink(props: NavLinkProps) {
  return <NavLink {...props} />;
}
