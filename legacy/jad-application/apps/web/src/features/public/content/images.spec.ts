import { describe, expect, it } from 'vitest';

import { photoSrcSet, photoUrl } from './images';

describe('photoUrl - hybrid-aware', () => {
  it('builds Unsplash URL for existing photo-* ID', () => {
    expect(photoUrl('photo-1600585154340-be6161a56a0c', 900)).toBe(
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80',
    );
  });

  it('returns Supabase HTTPS public URL directly', () => {
    const supabaseUrl =
      'https://vudwoqduebdgtzvybywb.supabase.co/storage/v1/object/public/marketing-tools/cms/123-test.jpg';
    expect(photoUrl(supabaseUrl, 900)).toBe(supabaseUrl);
  });

  it('returns HTTP URL directly if supported', () => {
    const httpUrl = 'http://example.com/image.jpg';
    expect(photoUrl(httpUrl, 800)).toBe(httpUrl);
  });

  it('returns blob: and data: URLs directly', () => {
    expect(photoUrl('blob:mock-url', 400)).toBe('blob:mock-url');
    expect(photoUrl('data:image/png;base64,abc', 400)).toBe('data:image/png;base64,abc');
  });

  it('returns empty for empty/invalid ID', () => {
    expect(photoUrl('', 900)).toBe('');
  });

  it('photoSrcSet builds Unsplash srcSet for photo-* ID', () => {
    expect(photoSrcSet('photo-1600585154340-be6161a56a0c', [640, 900])).toBe(
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=640&q=80 640w, https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80 900w',
    );
  });

  it('photoSrcSet returns empty for direct Supabase HTTPS URL', () => {
    const supabaseUrl =
      'https://vudwoqduebdgtzvybywb.supabase.co/storage/v1/object/public/marketing-tools/cms/123-test.jpg';
    expect(photoSrcSet(supabaseUrl, [640, 900])).toBe('');
  });

  it('photoSrcSet returns empty for http, blob, data URLs', () => {
    expect(photoSrcSet('http://example.com/a.jpg', [640])).toBe('');
    expect(photoSrcSet('blob:mock', [640])).toBe('');
    expect(photoSrcSet('data:image/png;base64,abc', [640])).toBe('');
  });

  it('photoSrcSet returns empty for empty ID', () => {
    expect(photoSrcSet('', [640])).toBe('');
  });
});
