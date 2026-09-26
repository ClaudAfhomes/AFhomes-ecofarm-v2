import type { Photo } from './types';

/**
 * Centralized image catalog for the public website.
 *
 * All photos are high-quality stock imagery served remotely from Unsplash
 * (`images.unsplash.com`). They represent the *types* of property JA&D works
 * with, not specific live listings. Centralizing IDs here means the full set
 * can be swapped for approved real-property photography in one place.
 */

/** Build a sized Unsplash URL for a photo id, or return a direct URL unchanged (Supabase Storage, blob, data). */
export function photoUrl(id: string, width: number): string {
  if (!id) return '';
  if (
    id.startsWith('https://') ||
    id.startsWith('http://') ||
    id.startsWith('blob:') ||
    id.startsWith('data:')
  ) {
    return id;
  }
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;
}

/** Build a responsive `srcSet` for a photo id at the given widths. Direct URLs return empty to avoid invalid Unsplash URLs. */
export function photoSrcSet(id: string, widths: number[]): string {
  if (!id) return '';
  if (
    id.startsWith('https://') ||
    id.startsWith('http://') ||
    id.startsWith('blob:') ||
    id.startsWith('data:')
  ) {
    return '';
  }
  return widths.map((width) => `${photoUrl(id, width)} ${width}w`).join(', ');
}

/** Web-optimized JA&D logo served from the app's own `public/` directory. */
export const LOGO = {
  src: '/ja-d-logo.png',
  /** Intrinsic dimensions of the resized asset (800×498, aspect 1.607). */
  width: 800,
  height: 498,
  alt: 'JA&D Realty Services',
};

export const IMAGES = {
  /** Home hero. */
  hero: {
    id: 'photo-1600585154340-be6161a56a0c',
    alt: 'A modern residence with warm interior lighting at dusk',
  },
  /** Home value section. */
  value: {
    id: 'photo-1600607687939-ce8a6c25118c',
    alt: 'A bright, open luxury interior with floor-to-ceiling windows',
  },
  /** About preview. */
  aboutPreview: {
    id: 'photo-1522708323590-d24dbb6b0267',
    alt: 'A thoughtfully furnished apartment living room',
  },
  /** CTA band. */
  cta: {
    id: 'photo-1613490493576-7fde63acd811',
    alt: 'A contemporary villa exterior at golden hour',
  },
} satisfies Record<string, Photo>;

/** Property category tiles. */
export const CATEGORY_IMAGES = {
  condominium: { id: 'photo-1460317442991-0ec209397118', alt: 'A modern condominium tower' },
  landLeisure: {
    id: 'photo-1506905925346-21bda4d32df4',
    alt: 'A scenic leisure property landscape',
  },
  commercial: {
    id: 'photo-1486406146926-c627a92ad1ab',
    alt: 'A contemporary development building',
  },
} satisfies Record<string, Photo>;

/**
 * Gallery images for each property listing, keyed by property id. All are
 * representative stock imagery of the *type* of property - never a claim that a
 * specific unit is exactly represented. The first image is the card/detail hero.
 * Mountain View placeholders are staged in 4 + 2 slots to match the six legacy
 * flyers; swap in the real flyer files when they are available.
 */
export const PROPERTY_IMAGES = {
  '2-storey-house-sucat': [
    { id: 'photo-1568605114967-8130f3a36994', alt: 'A suburban family house exterior' },
    {
      id: 'photo-1600585154340-be6161a56a0c',
      alt: 'A modern residence with warm interior lighting at dusk',
    },
    { id: 'photo-1512917774080-9991f1c4c750', alt: 'A two-storey home exterior at dusk' },
  ],
  'prisma-residences-astra': [
    {
      id: 'photo-1522708323590-d24dbb6b0267',
      alt: 'A thoughtfully furnished apartment living room',
    },
    {
      id: 'photo-1560448204-e02f11c3d0e2',
      alt: 'A bright apartment interior with modern finishes',
    },
  ],
  'prisma-residences-celeste': [
    {
      id: 'photo-1600607687939-ce8a6c25118c',
      alt: 'A bright, open luxury interior with floor-to-ceiling windows',
    },
    { id: 'photo-1600210492486-724fe5c67fb0', alt: 'A modern apartment living space' },
    { id: 'photo-1556912167-f556f1f39fdf', alt: 'A modern kitchen with fitted cabinetry' },
  ],
  'levina-place': [
    { id: 'photo-1600210492486-724fe5c67fb0', alt: 'A modern apartment living space' },
    {
      id: 'photo-1560448204-e02f11c3d0e2',
      alt: 'A bright apartment interior with modern finishes',
    },
  ],
  'prisma-residences': [
    { id: 'photo-1460317442991-0ec209397118', alt: 'A modern condominium tower' },
    { id: 'photo-1582407947304-fd86f028f716', alt: 'A contemporary apartment building exterior' },
  ],
  'income-generating-lots-1000-sqm': [
    { id: 'photo-1500382017468-9049fed747ef', alt: 'A wide open field of land under a bright sky' },
    { id: 'photo-1470071459604-3b5ec3a7fe05', alt: 'Rolling green hills in soft morning light' },
  ],
  'income-generating-lots-500-520-sqm': [
    { id: 'photo-1470071459604-3b5ec3a7fe05', alt: 'Rolling green hills in soft morning light' },
    { id: 'photo-1500530855697-b586d89ba3ee', alt: 'A green landscape with open grassland' },
  ],
  'igp-lots': [
    { id: 'photo-1500530855697-b586d89ba3ee', alt: 'A green landscape with open grassland' },
    { id: 'photo-1500382017468-9049fed747ef', alt: 'A wide open field of land under a bright sky' },
  ],
  'mountain-view': [
    {
      id: 'photo-1454496522488-7a8e488e8606',
      alt: 'A dramatic mountain landscape under clear skies',
    },
    { id: 'photo-1506905925346-21bda4d32df4', alt: 'A scenic leisure property landscape' },
    { id: 'photo-1470770841072-f978cf4d019e', alt: 'A mountain lake beneath a clear sky' },
    { id: 'photo-1519681393784-d120267933ba', alt: 'A mountain ridge under a starry dusk sky' },
  ],
  'mountain-suites': [
    {
      id: 'photo-1566073771259-6a8506099945',
      alt: 'A resort pool with lounge chairs and palm trees',
    },
    {
      id: 'photo-1584132967334-10e028bd69f7',
      alt: 'A modern resort suite with a private terrace',
    },
  ],
} satisfies Record<string, Photo[]>;

/** About page imagery. */
export const ABOUT_IMAGES = {
  advisory: {
    id: 'photo-1497366754035-f200968a6e72',
    alt: 'A calm, light-filled office space',
  },
  trust: {
    id: 'photo-1450101499163-c8848c66ca85',
    alt: 'A hand reviewing documents at a desk',
  },
} satisfies Record<string, Photo>;

/**
 * Hero imagery for every public landing page - centralized so the full set can
 * be swapped for approved real-property photography in one place. Each page
 * gets its own relevant image while keeping a consistent JA&D visual identity.
 */
export const HERO_IMAGES = {
  /** Home - hero stays on the existing `IMAGES.hero`. */
  home: IMAGES.hero,
  about: {
    id: 'photo-1512917774080-9991f1c4c750',
    alt: 'A modern home exterior with warm lighting at dusk',
  },
  properties: {
    id: 'photo-1570129477492-45c003edd2be',
    alt: 'A classic family home exterior under a clear sky',
  },
  faqs: {
    id: 'photo-1486406146926-c627a92ad1ab',
    alt: 'A contemporary development building',
  },
  contact: IMAGES.cta,
} satisfies Record<string, Photo>;
