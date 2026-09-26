import { HERO_IMAGES } from './images';
import { MESSENGER_URL } from './contact';
import type { FaqItem } from './types';

/**
 * FAQ content. Customer-friendly questions and conservative answers consistent
 * with the approved brokerage positioning. No figures, yields, availability, or
 * financial outcomes are promised.
 */
export const FAQS = {
  eyebrow: 'FAQs',
  title: 'Frequently asked questions',
  hero: {
    eyebrow: 'FAQs',
    lead: 'Concise, plain-language answers to the questions buyers and sellers ask us most - before you talk to us.',
    image: HERO_IMAGES.faqs,
    primaryCta: { label: 'Talk to Us', to: '/contact' },
  },
  intro: {
    eyebrow: 'Quick answers',
    statement: 'Questions answered clearly.',
    body: 'A short reference for the questions people ask us most often. Each answer stays close to how we actually work as a brokerage - no projections, no promises. If you do not see yours here, ask us directly.',
  },
  cta: {
    title: 'Still have questions?',
    lead: 'We are happy to walk you through how it works - reach us on Messenger or through the contact page.',
    primaryCta: { label: "Let's Talk", href: MESSENGER_URL },
    secondaryCta: { label: 'Contact Us', to: '/contact' },
  },
  items: [
    {
      question: 'What does JA&D Realty Services specialize in?',
      answer:
        'We are a real-estate brokerage specializing in titled, income-oriented property opportunities - most notably tenanted condominium resales, income-generating properties with leases already in place, and brokerage for licensed developer projects. Our focus is good value for money, backed by due diligence and complete documentation.',
    },
    {
      question: 'What is a tenanted property?',
      answer:
        'A tenanted property is a titled unit or lot that already has a paying tenant under a live lease. When you buy it, you become the landlord and collect the rent directly under the existing lease - you own the title in your name from the start.',
    },
    {
      question: 'How does the brokerage process work?',
      answer:
        'It starts with understanding your goal. We present opportunities that fit, verify the title and lease documents through due diligence, then guide you through the transfer so that every document and step is complete and correct. We are a brokerage - we do not pool funds or manage money; you own the property directly.',
    },
    {
      question: 'What does due diligence mean?',
      answer:
        'Due diligence means we verify before we recommend. Titles are checked for clean ownership, lease contracts are reviewed, and every claim about a property is confirmed against its documents before it is presented to you.',
    },
    {
      question: 'Who can work with JA&D?',
      answer:
        'Buyers and sellers of property - including Filipino clients at home and overseas - can work with us. Tell us what you are looking for, or what you have, and we will guide you through the process.',
    },
    {
      question: 'Does JA&D guarantee investment returns?',
      answer:
        'No. As a brokerage, we do not manage money, pool funds, or promise returns. We present documented, titled property opportunities and make sure every step is complete and correct - the property itself, and its existing lease, are what work for you.',
    },
  ] satisfies FaqItem[],
};
