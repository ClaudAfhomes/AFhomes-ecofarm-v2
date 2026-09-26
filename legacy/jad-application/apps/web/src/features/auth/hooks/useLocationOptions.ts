import { useQuery } from '@tanstack/react-query';

import { getBarangays, getCities, getProvinces } from '../../../lib/api/endpoints';

/**
 * Philippine location reference lists for the registration address step.
 * Each level loads only when its parent is selected (no dataset is ever
 * bundled - the lists page through `GET /locations/*`). Reference data is
 * stable, so results stay cached for the session.
 */
const REFERENCE_STALE_TIME = 60 * 60 * 1000;

export function useProvinces(countryCode: string) {
  return useQuery({
    queryKey: ['locations', 'provinces', countryCode],
    queryFn: () => getProvinces(countryCode),
    enabled: countryCode === 'PH',
    staleTime: REFERENCE_STALE_TIME,
    retry: false,
  });
}

export function useCities(provinceCode: string) {
  return useQuery({
    queryKey: ['locations', 'cities', provinceCode],
    queryFn: () => getCities(provinceCode),
    enabled: provinceCode.length > 0,
    staleTime: REFERENCE_STALE_TIME,
    retry: false,
  });
}

export function useBarangays(cityCode: string) {
  return useQuery({
    queryKey: ['locations', 'barangays', cityCode],
    queryFn: () => getBarangays(cityCode),
    enabled: cityCode.length > 0,
    staleTime: REFERENCE_STALE_TIME,
    retry: false,
  });
}
