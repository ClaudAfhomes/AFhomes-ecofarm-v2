import type { Barangay, Locality, Province } from '@afhomes/contracts';
import { Combobox } from './Combobox';
import { TextField } from './TextField';

export type OstAddressSelection = {
  regionCode: string;
  region: string;
  provinceCode: string;
  province: string;
  localityCode: string;
  city: string;
  barangayCode: string;
  barangay: string;
  postalCode: string;
};
export const emptyOstAddress = (): OstAddressSelection => ({
  regionCode: '',
  region: '',
  provinceCode: '',
  province: '',
  localityCode: '',
  city: '',
  barangayCode: '',
  barangay: '',
  postalCode: '',
});
type Lookup<T> = {
  data?: T[];
  isFetching: boolean;
  isError: boolean;
  refetch: () => unknown;
};

/** Both OST entry points use the same controlled cascade; queries stay in each app. */
export function OstAddressFields({
  value,
  onChange,
  regions,
  provinces,
  localities,
  barangays,
  showRegion = true,
}: {
  showRegion?: boolean;
  value: OstAddressSelection;
  onChange: (next: OstAddressSelection) => void;
  regions: Lookup<Province>;
  provinces: Lookup<Province>;
  localities: Lookup<Locality>;
  barangays: Lookup<Barangay>;
}) {
  const shown = (code: string, name: string) => (code ? { code, name } : null);
  return (
    <>
      {showRegion ? (
        <Combobox
          id="ost-region"
          label="Region"
          required
          value={shown(value.regionCode, value.region)}
          options={regions.data ?? []}
          loading={regions.isFetching}
          error={regions.isError ? 'Unable to load regions.' : null}
          onRetry={() => void regions.refetch()}
          onSelect={(option) =>
            onChange({
              ...emptyOstAddress(),
              regionCode: option?.code ?? '',
              region: option?.name ?? '',
            })
          }
        />
      ) : null}
      <Combobox
        id="ost-province"
        label="Province"
        required
        disabled={showRegion && !value.regionCode}
        value={shown(value.provinceCode, value.province)}
        options={provinces.data ?? []}
        loading={provinces.isFetching}
        error={provinces.isError ? 'Unable to load provinces.' : null}
        onRetry={() => void provinces.refetch()}
        onSelect={(option) =>
          onChange({
            ...emptyOstAddress(),
            regionCode: value.regionCode,
            region: value.region,
            provinceCode: option?.code ?? '',
            province: option?.name ?? '',
          })
        }
      />
      <Combobox
        id="ost-city"
        label="City / municipality"
        required
        disabled={!value.provinceCode}
        value={shown(value.localityCode, value.city)}
        options={localities.data ?? []}
        loading={localities.isFetching}
        error={localities.isError ? 'Unable to load cities and municipalities.' : null}
        onRetry={() => void localities.refetch()}
        onSelect={(option) => {
          const locality = localities.data?.find((item) => item.code === option?.code);
          onChange({
            ...value,
            localityCode: option?.code ?? '',
            city: option?.name ?? '',
            barangayCode: '',
            barangay: '',
            postalCode: locality?.postalCode ?? '',
          });
        }}
      />
      <Combobox
        id="ost-barangay"
        label="Barangay"
        required
        disabled={!value.localityCode}
        value={shown(value.barangayCode, value.barangay)}
        options={barangays.data ?? []}
        loading={barangays.isFetching}
        error={barangays.isError ? 'Unable to load barangays.' : null}
        onRetry={() => void barangays.refetch()}
        onSelect={(option) =>
          onChange({ ...value, barangayCode: option?.code ?? '', barangay: option?.name ?? '' })
        }
      />
      <TextField
        id="ost-postal"
        name="postalCode"
        label="ZIP / postal code"
        value={value.postalCode}
        onChange={() => {}}
        readOnly
        optional
      />
      {value.localityCode && !value.postalCode ? (
        <p>
          No unique postal reference match. The postal code remains unknown; have authorized staff
          verify the postal district against the approved postal reference before using it for
          delivery.
        </p>
      ) : null}
    </>
  );
}
