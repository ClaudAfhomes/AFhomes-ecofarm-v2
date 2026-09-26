import type { NavItem } from './types';

/**
 * Site-wide identity and navigation.
 *
 * Brand positioning follows the legacy website: "Where Big Dreams Meet
 * Property That Already Earns" - a brokerage specializing in titled,
 * income-oriented, tenant-occupied property opportunities.
 */
export const SITE = {
  name: 'JA&D Realty Services',
  shortName: 'JA&D',
  tagline: 'A real-estate brokerage built on diligence, documentation, and dependable value.',
  positioning: {
    line: 'Where Big Dreams Meet Property That Already Earns',
  },
  nav: [
    { to: '/', label: 'Home' },
    { to: '/about', label: 'About Us' },
    { to: '/properties', label: 'Properties' },
    { to: '/faqs', label: 'FAQs' },
    { to: '/contact', label: 'Contact' },
  ] satisfies NavItem[],
  /** Member auth actions rendered in the header (SCR-AUTH-001/002 preview). */
  auth: [
    { to: '/login', label: 'Login' },
    { to: '/register', label: 'Register' },
  ] satisfies NavItem[],
  footer: {
    brandLine:
      'A licensed independent real-estate brokerage connecting buyers and sellers with titled, income-oriented property opportunities.',
  },
  /** Shared internal CTAs. */
  cta: {
    explore: { label: 'Explore Properties', to: '/properties' },
    discover: { label: 'Discover JA&D', to: '/about' },
    faqs: { label: 'Read the FAQs', to: '/faqs' },
  },
};
