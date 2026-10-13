/**
 * Digital VIP card artwork mapping.
 *
 * The tier artwork is an EXPLICIT code -> asset map, never array-index based,
 * so a presentation-order change can never show the wrong card. Gold, Silver
 * and Bronze each resolve to their own official asset; anything unrecognised
 * falls back to Silver, mirroring the marketing tier card.
 */
import { describe, expect, it } from 'vitest';

import { tierArtwork } from './tier-artwork';

describe('tierArtwork explicit mapping', () => {
  it('maps GOLD to the gold official artwork', () => {
    expect(tierArtwork('GOLD').src).toMatch(/gold-card/);
    expect(tierArtwork('GOLD').alt).toMatch(/gold/i);
  });

  it('maps SILVER to the silver official artwork', () => {
    expect(tierArtwork('SILVER').src).toMatch(/silver-card/);
    expect(tierArtwork('SILVER').alt).toMatch(/silver/i);
  });

  it('maps BRONZE to the bronze official artwork', () => {
    expect(tierArtwork('BRONZE').src).toMatch(/bronze-card/);
    expect(tierArtwork('BRONZE').alt).toMatch(/bronze/i);
  });

  it('all three tiers resolve to distinct assets', () => {
    const sources = [tierArtwork('GOLD'), tierArtwork('SILVER'), tierArtwork('BRONZE')].map(
      (art) => art.src,
    );
    expect(new Set(sources).size).toBe(3);
  });

  it('is case- and whitespace-tolerant, and order-independent', () => {
    expect(tierArtwork('gold').src).toBe(tierArtwork('GOLD').src);
    expect(tierArtwork('  Silver ').src).toBe(tierArtwork('SILVER').src);
    // Scrambled input order still maps each code to its own asset.
    expect(tierArtwork('BRONZE').src).toMatch(/bronze-card/);
    expect(tierArtwork('GOLD').src).toMatch(/gold-card/);
  });

  it('falls back to Silver for unknown, empty or missing codes', () => {
    for (const code of ['PLATINUM', '', null, undefined]) {
      expect(tierArtwork(code).src).toBe(tierArtwork('SILVER').src);
    }
  });
});
