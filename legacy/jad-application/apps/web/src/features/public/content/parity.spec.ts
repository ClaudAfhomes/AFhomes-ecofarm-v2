import { describe, expect, it } from 'vitest';

import {
  CMS_ABOUT_SEED,
  CMS_CONTACT_SEED,
  CMS_FAQS_SEED,
  CMS_GLOBAL_SEED,
  CMS_HOMEPAGE_SEED,
  CMS_PROPERTIES_SEED,
  PROGRAM_SEEDS,
} from '@jad/contracts';
import { createMockStore } from '../../../mock/store';

import { ABOUT } from './about';
import { CONTACT, MESSENGER_URL } from './contact';
import { FAQS } from './faqs';
import { HOME } from './home';
import { PROPERTIES, PROPERTY_CATEGORIES, PROPERTY_RECORDS } from './properties';
import { SITE } from './site';

/**
 * CMS ↔ static fallback parity (Phase 4 consistency pass, Q6).
 * The seeds are the DB source; the static files are the silent fallback -
 * their values must match field-for-field or users see different content
 * depending on fetch success.
 */
describe('reference-data seed parity', () => {
  it('matches store programs to the contracts seed', () => {
    expect(createMockStore().programs).toEqual(PROGRAM_SEEDS);
  });

  it('matches store config values to the contracts seed', () => {
    const store = createMockStore();
    expect(store.minAge).toBe(18);
    expect(store.genders).toEqual(['Male', 'Female', 'Others']);
  });
});

describe('cms seed parity', () => {
  it('matches the homepage exactly', () => {
    expect(JSON.stringify(HOME)).toBe(JSON.stringify(CMS_HOMEPAGE_SEED));
  });

  it('matches the FAQs exactly', () => {
    expect(JSON.stringify(FAQS)).toBe(JSON.stringify(CMS_FAQS_SEED));
  });

  it('matches the properties page and categories modulo isFeatured', () => {
    expect(JSON.stringify(PROPERTIES)).toBe(JSON.stringify(CMS_PROPERTIES_SEED.page));
    expect(PROPERTY_CATEGORIES.map(({ slug, title }) => ({ slug, title }))).toEqual(
      CMS_PROPERTIES_SEED.categories.map(({ slug, title }) => ({ slug, title })),
    );
    const strip = (p: { isFeatured?: boolean } & Record<string, unknown>) => {
      const rest: Record<string, unknown> = { ...p };
      delete rest.isFeatured;
      return rest;
    };
    expect(PROPERTY_RECORDS.map(strip)).toEqual(CMS_PROPERTIES_SEED.properties.map(strip));
  });

  it('matches about values across the hero split', () => {
    expect(ABOUT.eyebrow).toBe(CMS_ABOUT_SEED.hero.eyebrow);
    expect(ABOUT.title).toBe(CMS_ABOUT_SEED.hero.title);
    expect(ABOUT.lead).toBe(CMS_ABOUT_SEED.hero.lead);
    expect(ABOUT.hero.image).toEqual(CMS_ABOUT_SEED.hero.image);
  });

  it('matches contact values and method labels', () => {
    expect(CONTACT.title).toBe(CMS_CONTACT_SEED.title);
    expect(MESSENGER_URL).toBe('https://m.me/JADRealtyServices');
    const staticMethods = CONTACT.methods.map(({ label, value, href }) => ({ label, value, href }));
    for (const method of CMS_CONTACT_SEED.methods) {
      expect(staticMethods).toContainEqual({
        label: method.label,
        value: method.value,
        href: 'href' in method ? (method as { href?: string }).href : undefined,
      });
    }
  });

  it('matches brand and nav values', () => {
    expect(SITE.name).toBe(CMS_GLOBAL_SEED.brand.name);
    expect(SITE.tagline).toBe(
      'A real-estate brokerage built on diligence, documentation, and dependable value.',
    );
    expect(SITE.positioning.line).toBe(CMS_GLOBAL_SEED.brand.positioningLine);
    expect(SITE.nav.map(({ to, label }) => ({ to, label }))).toEqual(
      CMS_GLOBAL_SEED.nav.map(({ to, label }) => ({ to, label })),
    );
  });
});
