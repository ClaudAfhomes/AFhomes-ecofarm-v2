import { useQuery } from '@tanstack/react-query';
import { barangaySchema, localitySchema, provinceSchema } from '@afhomes/contracts';
import type { OstAddressSelection } from '@afhomes/ui';
import { protectedRequestList } from '../../lib/api/client';

export function useOstAddress(value: OstAddressSelection) {
  const common = { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false, retry: false };
  const regions = useQuery({ ...common, queryKey: ['address', 'regions'],
    queryFn: () => protectedRequestList('/address/regions', provinceSchema) });
  const provinces = useQuery({ ...common, queryKey: ['address', 'region-provinces', value.regionCode], enabled: Boolean(value.regionCode),
    queryFn: () => protectedRequestList(`/address/regions/${value.regionCode}/provinces`, provinceSchema) });
  const localities = useQuery({ ...common, queryKey: ['address', 'localities', value.provinceCode], enabled: Boolean(value.provinceCode),
    queryFn: () => protectedRequestList(`/address/provinces/${value.provinceCode}/localities`, localitySchema) });
  const barangays = useQuery({ ...common, queryKey: ['address', 'barangays', value.localityCode], enabled: Boolean(value.localityCode),
    queryFn: () => protectedRequestList(`/address/localities/${value.localityCode}/barangays`, barangaySchema) });
  return { regions, provinces, localities, barangays };
}
