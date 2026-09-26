import { ABOUT_IMAGES, HERO_IMAGES } from './images';
import type { CtaLink, Pillar } from './types';

/**
 * About page content. The company story is written from the legacy website's
 * positioning and the three readings of the JA&D name. No corporate history,
 * founding dates, or registration facts are claimed - those remain for the
 * owner to confirm.
 */
export const ABOUT = {
  eyebrow: 'About',
  title: 'About JA&D Realty Services',
  lead: 'A licensed independent brokerage built on diligence, dependable value, and the belief that property can serve bigger dreams.',
  hero: {
    eyebrow: 'About',
    image: HERO_IMAGES.about,
    primaryCta: { label: 'Explore Properties', to: '/properties' },
  } satisfies {
    eyebrow: string;
    image: { id: string; alt: string };
    primaryCta: CtaLink;
  },
  intro: {
    eyebrow: 'Who we are',
    title: 'Property that already works.',
    label: {
      title: 'An independent brokerage',
      body: 'Guiding buyers and sellers at every step.',
    },
    paragraphs: [
      'JA&D Realty Services is a real-estate brokerage that specializes in titled, income-oriented property opportunities. Our niche is straightforward: we find property that already works - titled units and lots with clean documents and, where possible, a tenant already in place under a live lease.',
      'We bridge sellers and buyers with good value for money in mind, and we guide both sides through every document and step until the transfer is complete and correct. As a brokerage, we do not pool funds, manage money, or promise returns - you own the title, and the property works for you directly.',
    ],
    image: ABOUT_IMAGES.advisory,
  } satisfies {
    eyebrow: string;
    title: string;
    label: { title: string; body: string };
    paragraphs: string[];
    image: { id: string; alt: string };
  },
  philosophy: {
    eyebrow: 'The JA&D philosophy',
    title: 'Three readings of our name.',
    lead: 'Three readings of our name shape how we work every day.',
    items: [
      {
        title: 'Judicious Advisory & Diligence',
        body: 'We advise carefully and verify thoroughly. Every title and lease document is reviewed so decisions are made on facts, not promises.',
      },
      {
        title: 'Journey of Achievable & Dependable',
        body: 'We keep the path to property ownership realistic and dependable - clear steps, complete paperwork, and honest guidance along the way.',
      },
      {
        title: 'Just Aspirations & Dreams',
        body: 'Behind every property is a plan for a better life. We treat those plans with respect and work to make them achievable.',
      },
    ] satisfies Pillar[],
  } satisfies {
    eyebrow: string;
    title: string;
    lead: string;
    items: Pillar[];
  },
  approach: {
    eyebrow: 'Our approach',
    title: 'Due diligence is non-negotiable.',
    lead: 'Our work begins with understanding what you are looking for - as a buyer, a seller, or someone simply exploring what income-oriented property can offer. We then present opportunities that fit: titled property with documented leases and clear ownership.',
    points: [
      {
        title: 'Due diligence first',
        body: 'Titles are checked, leases are reviewed, and every claim is verified before a property is presented.',
      },
      {
        title: 'Complete documentation',
        body: 'We coordinate the transfer so the documents you receive are complete, correct, and in order.',
      },
      {
        title: 'Clear boundaries',
        body: 'You own the title and collect the rent directly under the existing lease - we never pool funds or manage money.',
      },
    ] satisfies Pillar[],
    image: ABOUT_IMAGES.trust,
  } satisfies {
    eyebrow: string;
    title: string;
    lead: string;
    points: Pillar[];
    image: { id: string; alt: string };
  },
  vision: {
    eyebrow: 'Vision',
    statement:
      'To be the brokerage that Filipinos - at home and abroad - trust for titled, income-oriented property, where every transaction is documented, every claim is verified, and every client makes an informed decision.',
  } satisfies { eyebrow: string; statement: string },
  mission: {
    eyebrow: 'Mission',
    title: 'Our mission',
    lead: 'To connect buyers and sellers with good-value, titled property opportunities - serving local and overseas Filipino clients with professional brokerage, rigorous due diligence, and complete transparency at every step.',
    points: [
      {
        title: 'Connect buyers and sellers',
        body: 'Good-value, titled property opportunities - you own the title, and the property works for you directly.',
      },
      {
        title: 'Serve clients at home and abroad',
        body: 'Professional brokerage for local and overseas Filipino clients, from first conversation to closing.',
      },
      {
        title: 'Rigorous due diligence',
        body: 'Rigorous due diligence and complete transparency at every step, with every claim verified before it is presented.',
      },
    ] satisfies Pillar[],
  } satisfies {
    eyebrow: string;
    title: string;
    lead: string;
    points: Pillar[];
  },
  cta: {
    title: 'See how the approach works',
    lead: 'Explore the property categories we specialize in, or talk with us about what you are looking for.',
    primaryCta: { label: 'Explore Properties', to: '/properties' } satisfies CtaLink,
    secondaryCta: { label: 'Talk to Us', to: '/contact' } satisfies CtaLink,
  },
};
