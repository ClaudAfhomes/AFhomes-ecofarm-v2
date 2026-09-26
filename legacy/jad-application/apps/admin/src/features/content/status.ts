import type { ContentKind } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  DOCUMENT: 'Document',
  IMAGE: 'Image',
  VIDEO: 'Video',
  PROMO: 'Promo',
};

export const CONTENT_KIND_TONE: Record<ContentKind, StatusTone> = {
  DOCUMENT: 'info',
  IMAGE: 'success',
  VIDEO: 'warning',
  PROMO: 'danger',
};
