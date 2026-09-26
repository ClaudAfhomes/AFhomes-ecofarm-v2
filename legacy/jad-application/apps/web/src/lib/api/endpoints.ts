import {
  barangayRefSchema,
  cityRefSchema,
  contactSubmissionResponseSchema,
  policySchema,
  programSchema,
  provinceRefSchema,
  publicConfigSchema,
} from '@jad/contracts';
import type {
  BarangayRef,
  CityRef,
  ContactSubmissionRequest,
  ContactSubmissionResponse,
  Policy,
  Program,
  ProvinceRef,
  PublicConfig,
} from '@jad/contracts';

import { request, requestList } from './client';

/**
 * Feature services - feature-scoped wrappers over the typed client
 * (FRONTEND-ARCHITECTURE §5). Only PUBLIC endpoints are consumed here.
 */

/** GET /config/public - non-sensitive config parameters (API-SPECIFICATION #81, FEAT-005). */
export function getPublicConfig(): Promise<PublicConfig> {
  return request('/config/public', publicConfigSchema);
}

/** GET /programs - Domestic / Abroad program list, public (API-SPECIFICATION #78, FEAT-068). */
export function getPrograms(): Promise<Program[]> {
  return requestList('/programs', programSchema);
}

/**
 * Philippine location reference lists (PUBLIC, seeded from the PSGC
 * publication). Parent-filtered and cache-friendly - the registration form
 * pages through them instead of bundling the dataset.
 */
export function getProvinces(countryCode: string): Promise<ProvinceRef[]> {
  return requestList(
    `/locations/provinces?countryCode=${encodeURIComponent(countryCode)}`,
    provinceRefSchema,
  );
}

export function getCities(provinceCode: string): Promise<CityRef[]> {
  return requestList(
    `/locations/cities?provinceCode=${encodeURIComponent(provinceCode)}`,
    cityRefSchema,
  );
}

export function getBarangays(cityCode: string): Promise<BarangayRef[]> {
  return requestList(
    `/locations/barangays?cityCode=${encodeURIComponent(cityCode)}`,
    barangayRefSchema,
  );
}

/** GET /policies - policies, guidelines, T&C (API-SPECIFICATION #69, FEAT-062). */
export function getPolicies(): Promise<Policy[]> {
  return requestList('/policies', policySchema);
}

/** POST /contact - public contact form submission. */
export function submitContact(input: ContactSubmissionRequest): Promise<ContactSubmissionResponse> {
  return request('/contact', contactSubmissionResponseSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
