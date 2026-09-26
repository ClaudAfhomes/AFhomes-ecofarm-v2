/**
 * Shared content types for the JAD public website.
 *
 * All copy below is the polished, owner-presentable marketing baseline. It is
 * authored to stay within the approved business positioning - no figures,
 * availability, or financial outcomes are claimed.
 */

/** Primary navigation / footer link. */
export interface NavItem {
  to: string;
  label: string;
}

/** Eyebrow + heading + optional lead used by section/page headers. */
export interface EyebrowTitleLead {
  eyebrow: string;
  title: string;
  lead?: string;
}

/** A call-to-action link (always renders as an internal route). */
export interface CtaLink {
  label: string;
  to: string;
  variant?: 'primary' | 'secondary';
}

/** Photo referenced from the centralized image catalog (Unsplash). */
export interface Photo {
  id: string;
  alt: string;
}

/** A numbered step in a process list. */
export interface ProcessStep {
  title: string;
  body: string;
}

/** A brand pillar / value statement. */
export interface Pillar {
  title: string;
  body: string;
}

/**
 * A property category presented on the site.
 *
 * `slug` is the URL segment (e.g. `tenanted-condo-resales`); properties
 * reference it via `Property.categoryId`. This is the single source of truth -
 * the UI derives category listings from it rather than duplicating records.
 */
export interface PropertyCategory {
  slug: string;
  title: string;
  /** Short description shown on category cards. */
  shortDescription: string;
  /** Longer description shown on the category page. */
  description: string;
  image: Photo;
}

/** A single key fact shown on the property detail page (label/value pair). */
export interface PropertyFact {
  label: string;
  value: string;
}

/**
 * A property listing in the catalog (content supplied by the project owner).
 * `id` is the URL slug, unique across the catalog. Prices are exact-decimal
 * strings per the money display contract (DESIGN-SYSTEM §9); absent when the
 * listing has no published price (e.g. licensed developer projects).
 */
export interface Property {
  /** URL slug, unique across the catalog (e.g. `prisma-residences-astra`). */
  id: string;
  name: string;
  /** References `PropertyCategory.slug`. */
  categoryId: string;
  location: string;
  /** Exact-decimal price string (e.g. `3200000.00`); format via `formatMoney`. */
  price?: string;
  /** Key property facts for the detail page. Empty when details are only available upon inquiry. */
  keyFacts: PropertyFact[];
  /** Short characteristic chips (e.g. `1 bd`, `28 m²`). */
  characteristics: string[];
  /** Overview paragraphs (supplied listing copy). */
  overview: string[];
  /** Property highlights derived from known facts only. */
  highlights: string[];
  /** Gallery images; the first is the hero. */
  gallery: Photo[];
}

/** FAQ entry. */
export interface FaqItem {
  question: string;
  answer: string;
}
