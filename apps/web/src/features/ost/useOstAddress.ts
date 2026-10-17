import { useQuery } from '@tanstack/react-query';
import { barangaySchema, localitySchema, provinceSchema } from '@afhomes/contracts';
import type { OstAddressSelection } from '@afhomes/ui';
import { requestList } from '../../lib/api/client';

export function useOstAddress(value: OstAddressSelection) {
  const common = { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false, retry: false };
  const regions = useQuery({ ...common, queryKey: ['address', 'regions'],
    queryFn: () => requestList('/address/public/regions', provinceSchema) });
  const provinces = useQuery({ ...common, queryKey: ['address', 'region-provinces', value.regionCode], enabled: Boolean(value.regionCode),
    queryFn: () => requestList(`/address/public/regions/${value.regionCode}/provinces`, provinceSchema) });
  const localities = useQuery({ ...common, queryKey: ['address', 'localities', value.provinceCode], enabled: Boolean(value.provinceCode),
    queryFn: () => requestList(`/address/public/provinces/${value.provinceCode}/localities`, localitySchema) });
  const barangays = useQuery({ ...common, queryKey: ['address', 'barangays', value.localityCode], enabled: Boolean(value.localityCode),
    queryFn: () => requestList(`/address/public/localities/${value.localityCode}/barangays`, barangaySchema) });
  return { regions, provinces, localities, barangays };
}
