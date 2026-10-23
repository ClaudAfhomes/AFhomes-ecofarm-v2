import { useQuery } from '@tanstack/react-query';
import { provinceSchema } from '@afhomes/contracts';
import type { OstAddressSelection } from '@afhomes/ui';
import { protectedRequestList } from '../../lib/api/client';
import { getAddressProvinces, getAddressLocalities, getAddressBarangays } from './services';

export function useOstAddress(value: OstAddressSelection, showRegion = true) {
  const common = { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false, retry: false };
  const regions = useQuery({
    ...common,
    queryKey: ['address', 'regions'],
    enabled: showRegion,
    queryFn: () => protectedRequestList('/address/regions', provinceSchema),
  });
  const provinces = useQuery({
    ...common,
    queryKey: showRegion
      ? ['address', 'region-provinces', value.regionCode]
      : ['address', 'provinces'],
    enabled: !showRegion || Boolean(value.regionCode),
    queryFn: showRegion
      ? () => protectedRequestList(`/address/regions/${value.regionCode}/provinces`, provinceSchema)
      : getAddressProvinces,
  });
  const localities = useQuery({
    ...common,
    queryKey: ['address', 'localities', value.provinceCode],
    enabled: Boolean(value.provinceCode),
    queryFn: () => getAddressLocalities(value.provinceCode),
  });
  const barangays = useQuery({
    ...common,
    queryKey: ['address', 'barangays', value.localityCode],
    enabled: Boolean(value.localityCode),
    queryFn: () => getAddressBarangays(value.localityCode),
  });
  return { regions, provinces, localities, barangays };
}
