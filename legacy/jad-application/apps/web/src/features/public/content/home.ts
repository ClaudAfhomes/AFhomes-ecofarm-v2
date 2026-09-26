import { IMAGES } from './images';
import type { CtaLink, Pillar, ProcessStep } from './types';

/**
 * Home page content. Copy follows the legacy brand positioning and the
 * approved brokerage scope: titled, income-oriented, tenant-occupied property
 * opportunities handled with due diligence and transparent documentation.
 * No financial outcomes, yields, or availability are claimed.
 */
export const HOME = {
  hero: {
    eyebrow: 'JA&D Realty Services',
    title: 'Where Big Dreams Meet Property That Already Earns',
    lead: 'A licensed independent brokerage specializing in titled, income-oriented property opportunities. We connect buyers and sellers, verify every document, and make sure every step of the process is complete and correct.',
    primaryCta: { label: 'Explore Properties', to: '/properties' },
    secondaryCta: { label: 'Discover JA&D', to: '/about' },
    image: IMAGES.hero,
  },
  value: {
    eyebrow: 'The JA&D difference',
    title: 'Good value for money - handled with diligence.',
    paragraphs: [
      'We find property that already works: titled units and lots with clean documents and, where possible, a tenant already in place under a live lease. The new owner becomes the landlord and collects rent directly under the existing lease - we never pool funds or manage money.',
      'From first conversation to closing, our role is advisory. We bridge sellers and buyers, verify the paperwork, and stay with you until every document and step is complete and correct.',
    ],
    image: IMAGES.value,
  },
  categories: {
    eyebrow: 'What we specialize in',
    title: 'A portfolio built around how you live and invest.',
    lead: 'Explore the types of properties we specialize in.',
  },
  featured: {
    eyebrow: 'What we represent',
    title: 'A glimpse of what we bring to the table.',
    lead: 'The types of property we specialize in - each opportunity is presented individually, with full documentation.',
    cta: { label: 'View Property Categories', to: '/properties' },
  },
  approach: {
    eyebrow: 'The brokerage approach',
    title: 'From first conversation to closing - transparent at every step.',
    steps: [
      {
        title: 'Understand your goal',
        body: 'We listen first - whether you are buying, selling, or exploring what income-oriented property can mean for you.',
      },
      {
        title: 'Present the right opportunity',
        body: 'We match you with titled, documented property opportunities suited to your goal and budget.',
      },
      {
        title: 'Verify every document',
        body: 'Due diligence comes first. Titles, leases, and legal documents are reviewed so nothing is left to chance.',
      },
      {
        title: 'Close with confidence',
        body: 'We coordinate the transfer so the buyer receives complete, correct documents - and ownership begins properly.',
      },
      {
        title: 'Support beyond closing',
        body: 'As a brokerage, we do not manage money or pool funds. You own the property and its income directly; we remain available for guidance.',
      },
    ] satisfies ProcessStep[],
  },
  trust: {
    eyebrow: 'Built on integrity',
    title: 'A brokerage you can hold accountable.',
    items: [
      {
        title: 'Property ownership, directly',
        body: 'You hold the title in your name. We never pool funds, manage money, or promise returns.',
      },
      {
        title: 'Due diligence first',
        body: 'Titles and lease documents are reviewed carefully before any opportunity is presented.',
      },
      {
        title: 'Complete documentation',
        body: 'Every transaction is supported by complete, correct documents - verified and explained to you.',
      },
      {
        title: 'Honest, professional advice',
        body: 'We help you understand what a property is and is not - so you can decide with confidence.',
      },
    ] satisfies Pillar[],
  },
  aboutPreview: {
    eyebrow: 'About JA&D',
    title: 'Diligence in every letter of our name.',
    lead: 'Judicious Advisory & Diligence. Journey of Achievable & Dependable. Just Aspirations & Dreams. The way we work is the meaning of our name.',
    image: IMAGES.aboutPreview,
    cta: { label: 'Discover JA&D', to: '/about' },
  },
  ctaBand: {
    title: 'Ready to explore what property can do for you?',
    lead: 'Have a property opportunity or looking for the right property? Talk with JA&D Realty Services - we will guide you through every step.',
    primaryCta: { label: 'Talk to Us', to: '/contact' },
    secondaryCta: { label: 'Read the FAQs', to: '/faqs' },
  },
} satisfies {
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    primaryCta: CtaLink;
    secondaryCta: CtaLink;
    image: { id: string; alt: string };
  };
  value: {
    eyebrow: string;
    title: string;
    paragraphs: string[];
    image: { id: string; alt: string };
  };
  categories: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  featured: {
    eyebrow: string;
    title: string;
    lead: string;
    cta: CtaLink;
  };
  approach: { eyebrow: string; title: string; steps: ProcessStep[] };
  trust: { eyebrow: string; title: string; items: Pillar[] };
  aboutPreview: {
    eyebrow: string;
    title: string;
    lead: string;
    image: { id: string; alt: string };
    cta: CtaLink;
  };
  ctaBand: { title: string; lead: string; primaryCta: CtaLink; secondaryCta: CtaLink };
};
