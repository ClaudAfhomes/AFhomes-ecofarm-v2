import { useCallback, useEffect, useRef, useState } from 'react';

import { verifyLocation } from '../services/locationVerification';
import type { LocationVerificationResponse } from '../services/locationVerification';

export type LocationVerificationStatus =
  | 'idle'
  | 'detecting'
  | 'verifying'
  | 'success'
  | 'permission-denied'
  | 'unavailable'
  | 'timeout'
  | 'failed'
  | 'blocked'
  | 'accuracy-fail';

export interface UseLocationVerificationResult {
  status: LocationVerificationStatus;
  data: LocationVerificationResponse | null;
  error: string | null;
  retry: () => void;
}

const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

function getGpsPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GPS_OPTIONS);
  });
}

export function useLocationVerification(enabled = true): UseLocationVerificationResult {
  const [status, setStatus] = useState<LocationVerificationStatus>('idle');
  const [data, setData] = useState<LocationVerificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  const verify = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setError(null);
    setData(null);

    // Step 1: Try GPS
    setStatus('detecting');
    let gpsPayload: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      timestamp?: string;
    } | null = null;
    let gpsStatus: LocationVerificationStatus | null = null;

    try {
      const pos = await getGpsPosition();
      if (attempt !== attemptRef.current) return;
      gpsPayload = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp).toISOString(),
      };
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      const err = e as GeolocationPositionError | Error;
      const code = (err as GeolocationPositionError).code;
      if (code === 1) {
        // PERMISSION_DENIED - will fallback to IP via BE
        gpsStatus = 'permission-denied';
      } else if (code === 2) {
        gpsStatus = 'unavailable';
      } else if (code === 3) {
        gpsStatus = 'timeout';
      } else if ((err as Error).message === 'Geolocation not supported') {
        gpsStatus = 'unavailable';
      } else {
        gpsStatus = 'unavailable';
      }
      // Do not return - proceed to IP fallback via BE
    }

    // Reflect intermediate GPS status for UI if needed, but still verify via BE
    if (gpsStatus) {
      setStatus(gpsStatus);
      // Small delay so UI can show permission-denied hint before verifying
      await new Promise((r) => setTimeout(r, 300));
      if (attempt !== attemptRef.current) return;
    }

    // Step 2: BE verification (authoritative)
    setStatus('verifying');
    try {
      const payload = gpsPayload ? gpsPayload : { ipFallback: true as const };
      const res = await verifyLocation(payload as never);
      if (attempt !== attemptRef.current) return;

      // Handle BE-level blocks
      if (res.blocked || res.requiresException) {
        setData(res);
        setStatus('blocked');
        return;
      }

      // Handle accuracy/spoof failure - BE may return 422 with specific code, but if res indicates it, treat as accuracy-fail
      // For now, if BE returns success but missing programId/country, treat as failed
      if (!res.verifiedCountryCode || !res.programId) {
        setError('Location could not be verified.');
        setStatus('failed');
        return;
      }

      setData(res);
      setStatus('success');
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Location verification failed. Please retry.';
      // Map known API error codes if available
      const apiErr = err as { code?: string; message?: string; status?: number };
      if (apiErr?.code === 'GEO_BLOCKED' || apiErr?.status === 403) {
        setStatus('blocked');
        setError(apiErr.message ?? 'Location is blocked for the selected program.');
        return;
      }
      if (apiErr?.code === 'GEO_ACCURACY_FAIL' || apiErr?.status === 422) {
        setStatus('accuracy-fail');
        setError(apiErr.message ?? 'Location accuracy could not be verified.');
        return;
      }
      // Backend not implemented (404) or network failure → verification failed
      // Do not invent mapping - surface as failed with retry
      setError(message);
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void verify();
  }, [enabled, verify]);

  const retry = useCallback(() => {
    void verify();
  }, [verify]);

  return { status, data, error, retry };
}
