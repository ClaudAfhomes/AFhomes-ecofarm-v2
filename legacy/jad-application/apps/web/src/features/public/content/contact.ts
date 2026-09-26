import { HERO_IMAGES } from './images';
import type { CtaLink } from './types';

/**
 * Single source of truth for the JA&D Messenger destination. Used by the
 * floating "Let's Talk" button, property detail "Message Us" CTAs, and the
 * contact page - never duplicated.
 */
export const MESSENGER_URL = 'https://m.me/JADRealtyServices';

export type ContactMethodIcon = 'messenger' | 'phone' | 'email' | 'location';

export type ContactMethod = {
  label: string;
  value: string;
  icon: ContactMethodIcon;
  href?: string;
  /** Open in a new tab with safe rel attributes (external destinations only). */
  external?: boolean;
  /** Visual emphasis: the strongest available contact action. */
  featured?: boolean;
};

/**
 * Contact page content. Contact details follow the legacy website (supplied
 * by the project owner); the form is presentational and does not submit -
 * submission will be connected with the live site later.
 */
export const CONTACT = {
  title: 'Talk with JA&D Realty Services',
  hero: {
    eyebrow: 'Contact',
    image: HERO_IMAGES.contact,
    primaryCta: { label: 'Explore Properties', to: '/properties' },
  },
  methods: [
    {
      label: 'Messenger',
      value: 'Message Us on Messenger',
      icon: 'messenger',
      href: MESSENGER_URL,
      external: true,
      featured: true,
    },
    { label: 'Phone', value: '0965-250-0052', icon: 'phone', href: 'tel:+639652500052' },
    {
      label: 'Email',
      value: 'info.jaandd@gmail.com',
      icon: 'email',
      href: 'mailto:info.jaandd@gmail.com',
    },
    {
      label: 'Office address',
      value:
        'Alaminos Commercial Complex, Unit 103-104, Maharlika Road, Brgy. San Juan, Alaminos, Laguna',
      icon: 'location',
    },
  ] satisfies ContactMethod[],
  form: {
    heading: 'Send us a message',
    note: 'Tell us what you are looking for - we will get back to you with the next steps.',
    submitLabel: 'Send Message',
  },
  cta: {
    title: 'Prefer to explore on your own first?',
    lead: 'Browse the property categories and common questions - then reach out when you are ready.',
    primaryCta: { label: 'Explore Properties', to: '/properties' } satisfies CtaLink,
    secondaryCta: { label: 'Read the FAQs', to: '/faqs' } satisfies CtaLink,
  },
  /** Shared by the site Footer; kept separate from the page's contact methods. */
  detailsHeading: 'Reach us directly',
  details: [
    {
      label: 'Office address',
      value:
        'Alaminos Commercial Complex, Unit 103-104, Maharlika Road, Brgy. San Juan, Alaminos, Laguna',
    },
    { label: 'Email', value: 'info.jaandd@gmail.com' },
    { label: 'Phone', value: '0965-250-0052' },
  ],
};
