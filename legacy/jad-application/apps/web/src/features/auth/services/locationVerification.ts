import { request } from '../../../lib/api/client';
import {
  locationVerificationResponseSchema as contractLocationVerificationResponseSchema,
  type LocationVerificationResponse as ContractLocationVerificationResponse,
} from '@jad/contracts';

/**
 * Location verification - BE authoritative.
 * POST /registration/location-verify (API-SPECIFICATION #16, FEAT-014/015, BR-GEO-001..004).
 * GPS primary, IP fallback. BE mapping PH → DOMESTIC, non-PH → ABROAD is isolated in
 * api/v1/registration/location-verify.ts. Frontend must NOT trust GPS alone.
 * If BE is not yet configured (GEO_UNAVAILABLE / 422), the hook surfaces a retryable failure
 * - never a PH default.
 */

// Re-export contract schema/response - single source of truth, backward compat via re-export
export const locationVerificationResponseSchema = contractLocationVerificationResponseSchema;
export type LocationVerificationResponse = ContractLocationVerificationResponse;

export type LocationVerificationPayload =
  | {
      latitude: number;
      longitude: number;
      accuracy?: number;
      timestamp?: string;
    }
  | {
      ipFallback: true;
    }
  | Record<string, never>;

export function verifyLocation(
  payload: LocationVerificationPayload,
): Promise<LocationVerificationResponse> {
  return request('/registration/location-verify', locationVerificationResponseSchema, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
