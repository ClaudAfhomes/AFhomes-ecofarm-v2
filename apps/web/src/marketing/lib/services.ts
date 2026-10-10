import { useQuery } from '@tanstack/react-query';
import { serviceCatalogItemSchema } from '@afhomes/contracts';
import type { z } from 'zod';
import { requestList } from '../../lib/api/client';
import { getPlaceholder } from './images';
import type { Experience } from '../types/experience';

export const usePublishedServices = () =>
  useQuery({
    queryKey: ['public', 'services'],
    queryFn: () => requestList('/earning/public/services', serviceCatalogItemSchema),
    refetchInterval: 240_000,
  });

export function serviceExperience(service: z.infer<typeof serviceCatalogItemSchema>): Experience {
  return {
    id: service.id,
    slug: service.id,
    name: service.name,
    shortName: service.name,
    actionLabel: 'View service',
    location: service.location ?? service.category ?? '',
    headline: service.name,
    summary: service.summary ?? service.description ?? 'Contact AF Homes for service details.',
    description: service.description ?? 'Contact AF Homes for service details.',
    highlights: [
      `Base price: PHP ${service.basePrice} per ${service.pricingUnit}`,
      ...service.highlights,
    ],
    theme: 'nature',
    accent: 'leaf',
    status:
      service.availability === 'available'
        ? 'open'
        : service.availability === 'coming_soon'
          ? 'opening-soon'
          : 'in-development',
    statusLabel:
      service.availability === 'available'
        ? 'Available'
        : service.availability === 'coming_soon'
          ? 'Coming soon'
          : 'Unavailable',
    image: service.photos[0]
      ? { src: service.photos[0].url, alt: service.photos[0].alt }
      : getPlaceholder('resort-hero'),
  };
}
