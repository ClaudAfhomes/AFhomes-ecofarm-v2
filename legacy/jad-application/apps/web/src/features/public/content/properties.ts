import { CATEGORY_IMAGES, HERO_IMAGES, PROPERTY_IMAGES } from './images';
import type { Photo, Pillar, Property, PropertyCategory } from './types';

/**
 * Properties page content.
 *
 * A static catalog of the current listings from the legacy website (supplied
 * by the project owner): named units, exact prices and availability, tenant
 * status, and descriptions. Rendered through the same premium browsing
 * experience as the site - no backend, database, or API yet. Gallery imagery
 * is representative stock photography, never a claim that a specific unit is
 * exactly represented.
 */

/** Label applied to gallery imagery (stock photos, not the real unit). */
export const REPRESENTATIVE_IMAGE_LABEL = 'Representative image';

/** Property categories. `slug` doubles as the URL segment. */
export const PROPERTY_CATEGORIES = [
  {
    slug: 'tenanted-condo-resales',
    title: 'Tenanted Condo Resales',
    shortDescription:
      'Resale condominium units and houses with tenants and existing lease contracts already in place.',
    description:
      'Individual resale of condominium units with tenants and existing lease contracts.',
    image: CATEGORY_IMAGES.condominium,
  },
  {
    slug: 'income-generating-properties',
    title: 'Income Generating Properties',
    shortDescription:
      'Titled hotspring lots in Laguna with a long-term lease already in place - ownership that earns from day one.',
    description:
      'Individual resale of a titled lot in Laguna with the long-term lease already in place. Title and ownership lead; the rent is stated as a fact of the existing lease, never a promise.',
    image: CATEGORY_IMAGES.landLeisure,
  },
  {
    slug: 'developer-project-brokerage',
    title: 'Developer Project Brokerage',
    shortDescription:
      'Accredited broker for licensed developer projects, connecting clients to vetted project opportunities.',
    description:
      'Accredited broker for licensed developer projects - e.g., Mountain View Leisure Community, Nasugbu (LTS No. 0001950).',
    image: CATEGORY_IMAGES.commercial,
  },
] satisfies PropertyCategory[];

/** Current property listings, supplied by the project owner (legacy website). */
export const PROPERTY_RECORDS = [
  {
    id: 'igp-250-sqm-farm-lot',
    name: '250 SQM Farm Lot with Hotspring',
    categoryId: 'income-generating-properties',
    location: 'Laguna',
    price: '1200000.00',
    keyFacts: [
      { label: 'Lot area', value: '250 m²' },
      { label: 'Available lots', value: '2 (250 m² each)' },
      { label: 'Price', value: '₱1.2M negotiable' },
    ],
    characteristics: ['250 m²', 'Hotspring', '2 lots available'],
    overview: [
      'Own a 250 sqm farm lot with natural hot spring access. Start earning rental income from day one with this income-generating property.',
      'Secure your investment today and enjoy the benefits of owning a hot spring property.',
    ],
    highlights: [
      '2 available lots (250 sqm each)',
      'Price: ₱1.2M negotiable',
      'Natural hot spring property',
      'Earn rental income from day 1',
      'Clean title - ready for transfer under your name',
    ],
    gallery: PROPERTY_IMAGES['igp-lots'],
  },
  {
    id: 'igp-titled-hotspring-lots',
    name: 'Titled Hotspring Lots',
    categoryId: 'income-generating-properties',
    location: 'Laguna',
    price: '2000000.00',
    keyFacts: [
      { label: 'Lot area', value: '520 m² - 3 lots available' },
      { label: 'Lot area', value: '500 m² - 2 lots available' },
      { label: 'Price', value: '₱2M-₱2.5M' },
    ],
    characteristics: ['520 m²', '500 m²', 'Tenanted'],
    overview: [
      'Own a prime hot spring property with existing tenants and enjoy rental income from day one.',
      'Secure your investment today - message us now for more details or to schedule a site viewing.',
    ],
    highlights: [
      '520 sqm - 3 lots available',
      '500 sqm - 2 lots available',
      'Price: ₱2M-₱2.5M',
      'Titled & ready for transfer',
      'Currently tenanted - immediate rental income',
    ],
    gallery: PROPERTY_IMAGES['income-generating-lots-500-520-sqm'],
  },
  {
    id: 'igp-1000-sqm-hotspring-lot',
    name: '1,000 SQM Hotspring Lot',
    categoryId: 'income-generating-properties',
    location: 'Laguna',
    price: '4000000.00',
    keyFacts: [
      { label: 'Lot area', value: '1,000 m²' },
      { label: 'Available lots', value: '4' },
      { label: 'Price', value: '₱4,000,000 only' },
    ],
    characteristics: ['1,000 m²', '4 lots', 'Hotspring', 'Direct owner resale'],
    overview: [
      'Own a 1,000 sqm titled hot spring lot with an existing tenant, providing immediate rental income from day one.',
      'Don’t miss this rare investment opportunity - only 4 lots available. Message us today for complete details or to schedule a site viewing.',
    ],
    highlights: [
      '1,000 sqm lot area (4 lots available)',
      'Price: ₱4,000,000 only',
      'Clean title - ready for transfer',
      'Currently tenanted - earn monthly rental income',
      'Genuine hotspring property',
      'Individual titled lot',
      'Direct owner resale',
    ],
    gallery: PROPERTY_IMAGES['income-generating-lots-1000-sqm'],
  },
  {
    id: 'prisma-celeste-8-6m',
    name: 'Prisma Residences - Celeste Building Condo',
    categoryId: 'tenanted-condo-resales',
    location: 'Pasig City',
    price: '8600000.00',
    keyFacts: [
      { label: 'Bedrooms', value: '2' },
      { label: 'Floor area', value: '56 m²' },
      { label: 'Price', value: 'From ₱8.6 million' },
      { label: 'Lease', value: 'Tenanted - active lease contract' },
    ],
    characteristics: ['2 bd', '56 m²', 'RFO', 'With tenant'],
    overview: [
      '2-bedroom condominium unit at Prisma Residences - Celeste Building, ready for occupancy (RFO) with an existing tenant and active lease contract - an income-generating unit.',
      'Ideal for investors or end-users looking for a premium property in a prime location.',
    ],
    highlights: [
      'Ready for occupancy (RFO)',
      '56 sqm floor area',
      '2 bedrooms',
      'With balcony and city view',
      'With existing tenant and active lease contract (income-generating unit)',
      'Ideal for investors or end-users looking for a premium property in a prime location',
    ],
    gallery: PROPERTY_IMAGES['prisma-residences'],
  },
  {
    id: 'levina-place-2br',
    name: 'Levina Place - 2BR Condo',
    categoryId: 'tenanted-condo-resales',
    location: 'Pasig City',
    price: '5500000.00',
    keyFacts: [
      { label: 'Bedrooms', value: '2' },
      { label: 'Bathrooms', value: '1' },
      { label: 'Price', value: 'From ₱5.5 million' },
      { label: 'Lease', value: 'Tenanted - active lease contract' },
    ],
    characteristics: ['2 bd', '1 ba', 'RFO', 'With tenant'],
    overview: [
      '2-bedroom condominium unit at Levina Place, ready for occupancy (RFO) with an existing tenant and active lease contract.',
      'Direct owner sale with clean title - ideal for investors seeking passive income or end-users looking for a prime property in a convenient location.',
    ],
    highlights: [
      'Ready for occupancy (RFO)',
      'Spacious 2-bedroom layout',
      '2 bedrooms',
      '1 bathroom',
      'With roofdeck drying area',
      'With existing tenant and active lease contract (income-generating unit)',
      'Direct owner sale with clean title',
      'Ideal for investors seeking passive income or end-users looking for a prime property in a convenient location',
    ],
    gallery: PROPERTY_IMAGES['levina-place'],
  },
  {
    id: 'prisma-celeste-8-3m',
    name: 'Prisma Residences - Celeste Building Condo',
    categoryId: 'tenanted-condo-resales',
    location: 'Pasig City',
    price: '8300000.00',
    keyFacts: [
      { label: 'Bedrooms', value: '2' },
      { label: 'Floor area', value: '56 m²' },
      { label: 'Price', value: 'From ₱8.3 million' },
      { label: 'Lease', value: 'Tenanted - active lease contract' },
    ],
    characteristics: ['2 bd', '56 m²', 'RFO', 'With tenant'],
    overview: [
      '2-bedroom condominium unit at Prisma Residences - Celeste Building, ready for occupancy (RFO) with an existing tenant and active lease contract.',
      'Located in the prestigious Prisma Residences by DMCI Homes.',
    ],
    highlights: [
      'Ready for occupancy (RFO)',
      '56 sqm floor area',
      '2 bedrooms',
      'With balcony and stunning city view',
      'With existing tenant and active lease contract (income-generating unit)',
      'Located in the prestigious Prisma Residences by DMCI Homes',
    ],
    gallery: PROPERTY_IMAGES['prisma-residences-celeste'],
  },
  {
    id: 'prisma-astra-1br',
    name: 'Prisma Residences - Astra Building Condo',
    categoryId: 'tenanted-condo-resales',
    location: 'Pasig City',
    price: '5300000.00',
    keyFacts: [
      { label: 'Bedrooms', value: '1' },
      { label: 'Floor area', value: '28 m²' },
      { label: 'Parking', value: 'N/A' },
      { label: 'Price', value: 'From ₱5.3 million' },
      { label: 'Lease', value: 'Tenanted - active lease contract' },
    ],
    characteristics: ['1 bd', '28 m²', 'RFO', 'With tenant'],
    overview: [
      '1-bedroom condominium unit at Prisma Residences - Astra Building, ready for occupancy (RFO) with an existing tenant and active lease contract.',
      'Located in the vibrant Prisma Residences community by DMCI Homes.',
    ],
    highlights: [
      'Ready for occupancy (RFO)',
      '28 sqm floor area',
      '1 bedroom',
      'Parking: N/A',
      'With existing tenant and active lease contract (income-generating unit)',
      'Located in the vibrant Prisma Residences community by DMCI Homes',
    ],
    gallery: PROPERTY_IMAGES['prisma-residences-astra'],
  },
  {
    id: '2-storey-house-sucat',
    name: '2-Storey House',
    categoryId: 'tenanted-condo-resales',
    location: 'Sucat, Parañaque',
    price: '3200000.00',
    keyFacts: [
      { label: 'Bedrooms', value: '2 (upstairs and downstairs)' },
      { label: 'Lot area', value: '25 m²' },
      { label: 'Floor area', value: '38 m²' },
      { label: 'Price', value: 'From ₱3.2 million' },
      { label: 'Lease', value: 'Tenanted - active lease contract' },
    ],
    characteristics: ['2-storey', '2 bd', '25 m² lot', 'With tenant'],
    overview: [
      '2-storey inner unit house and lot in Sucat, Parañaque, ready for occupancy (RFO) with an existing tenant and active lease contract.',
      'Ideal for investors seeking rental income or families looking for an affordable starter home.',
    ],
    highlights: [
      'Ready for occupancy (RFO)',
      'Lot area: 25 sqm',
      'Floor area: 38 sqm',
      '2 bedrooms (upstairs and downstairs)',
      'Inner unit facing east',
      'With existing tenant and active lease contract (income-generating property)',
      'Ideal for investors seeking rental income or families looking for an affordable starter home',
    ],
    gallery: PROPERTY_IMAGES['2-storey-house-sucat'],
  },
  {
    id: 'mountain-view-leisure-community',
    name: 'Mountain View Leisure Community',
    categoryId: 'developer-project-brokerage',
    location: 'Nasugbu, Batangas',
    keyFacts: [
      { label: 'Price', value: 'Starting at ₱6,860/sqm' },
      { label: 'Payment terms', value: 'Up to 7 years to pay' },
      { label: 'LTS No.', value: '0001950' },
      { label: 'TLS No.', value: '108 & 109' },
      { label: 'COR', value: '0003812 & 0003813' },
      { label: 'Availability', value: 'Limited lots available' },
    ],
    characteristics: ['₱6,860/sqm', '7 years to pay', 'LTS No. 0001950'],
    overview: [
      'Invest in serenity - own a prime elevated property in Nasugbu at Mountain View Leisure Community. Lots start at ₱6,860/sqm, with up to 7 years to pay.',
      'Your investment is secure and protected: LTS No. 0001950, TLS No. 108 & 109, COR 0003812 & 0003813. Message us for full details - limited lots available - or schedule a site viewing.',
    ],
    highlights: [
      'Prime elevated property in Nasugbu',
      'Starting at ₱6,860/sqm',
      'Up to 7 years to pay',
      'Limited lots available',
      'LTS No. 0001950 | TLS No. 108 & 109',
      'COR 0003812 & 0003813',
      'Phase 1 West, Phase 1 East & Phase 2 East',
    ],
    gallery: PROPERTY_IMAGES['mountain-view'],
  },
  {
    id: 'mountain-suites',
    name: 'Mountain Suites',
    categoryId: 'developer-project-brokerage',
    location: 'Nasugbu, Batangas',
    keyFacts: [
      { label: 'Price', value: 'Starting at ₱6,860/sqm' },
      { label: 'LTS No.', value: '0001950' },
      { label: 'TLS No.', value: '108 & 109' },
      { label: 'Availability', value: 'Limited lots available' },
    ],
    characteristics: ['₱6,860/sqm', 'LTS No. 0001950'],
    overview: [
      'Own a prime elevated property in Nasugbu at Mountain Suites - part of Mountain View Leisure Farm and Resort.',
      'Where prime living meets breathtaking views. Message us for full details - limited lots available.',
    ],
    highlights: [
      'Part of Mountain View Leisure Farm and Resort',
      'Prime elevated property in Nasugbu',
      'Starting at ₱6,860/sqm',
      'LTS No. 0001950 | TLS No. 108 & 109',
      'Limited lots available',
    ],
    gallery: PROPERTY_IMAGES['mountain-suites'],
  },
] satisfies Property[];

/** Shared overview/note text for the properties landing page. */
export const PROPERTIES = {
  eyebrow: 'Properties',
  title: 'Properties & Listings',
  lead: 'Explore the types of properties we specialize in. Every opportunity is presented individually, with full documentation and due diligence - talk with us about what you are looking for.',
  hero: {
    eyebrow: 'Properties',
    image: HERO_IMAGES.properties,
    primaryCta: { label: 'Talk to Us', to: '/contact' },
  },
  intro: {
    eyebrow: 'Browse by category',
    title: 'What we specialize in',
    lead: 'Pick a category to explore our current listings - every opportunity is presented individually, with complete documentation.',
  },
  featured: {
    eyebrow: 'Featured listings',
    title: 'A glimpse of what we bring to the table',
    lead: 'A look at what we offer. Every opportunity is presented individually, with complete documentation.',
  },
  note: {
    eyebrow: 'Presented individually',
    title: 'Browse by what you want to achieve',
    lead: 'Tell us what you are looking for, and we will bring you the opportunities that fit.',
    steps: [
      {
        title: 'Every opportunity, presented individually',
        body: 'Each property is presented with full documentation and due diligence - one opportunity at a time.',
      },
      {
        title: 'Documents reviewed, details explained',
        body: 'Every listing is shown with its documents reviewed and its details explained.',
      },
      {
        title: 'Message us for a site viewing',
        body: 'Message us now for more details or to schedule a site viewing.',
      },
    ] satisfies Pillar[],
  },
  cta: {
    title: 'Looking for a specific kind of property?',
    lead: 'Talk with JA&D Realty Services and tell us what you are looking for - we will match you with the right opportunity.',
    primaryCta: { label: 'Talk to Us', to: '/contact' },
  },
};

/* ---------------------------------------------------------------------------
 * Selectors - the UI derives listings from the catalog instead of duplicating
 * records. Future API integration can swap these implementations without
 * touching the components.
 * ------------------------------------------------------------------------- */

export function getCategoryBySlug(slug: string): PropertyCategory | undefined {
  return PROPERTY_CATEGORIES.find((category) => category.slug === slug);
}

export function getPropertyById(id: string): Property | undefined {
  return PROPERTY_RECORDS.find((property) => property.id === id);
}

/** Properties belonging to a category (empty array when the category is unknown). */
export function getPropertiesByCategory(categoryId: string): Property[] {
  return PROPERTY_RECORDS.filter((property) => property.categoryId === categoryId);
}

/** One property per category, for featured sections. */
export function getFeaturedProperties(limit = PROPERTY_CATEGORIES.length): Property[] {
  const featured = PROPERTY_CATEGORIES.map(
    (category) => getPropertiesByCategory(category.slug)[0],
  ).filter((property): property is Property => property !== undefined);
  return featured.slice(0, limit);
}

/**
 * Related properties for a detail page: peers in the same category first, then
 * other categories to reach `limit`. Never includes the current property.
 */
export function getRelatedProperties(property: Property, limit = 3): Property[] {
  const peers = getPropertiesByCategory(property.categoryId).filter(
    (candidate) => candidate.id !== property.id,
  );
  const others = PROPERTY_RECORDS.filter(
    (candidate) => candidate.categoryId !== property.categoryId && candidate.id !== property.id,
  );
  return [...peers, ...others].slice(0, limit);
}

/** Photo used as the card/detail hero for a property. */
export function getPropertyHeroPhoto(property: Property): Photo {
  return property.gallery[0]!;
}
