/**
 * The province -> city/municipality -> barangay block for a Customer
 * Application holder.
 *
 * One component serves PRIMARY and SECONDARY holders, so the two can never drift.
 * `idPrefix` keeps the DOM ids unique when both are on screen at once.
 *
 * THE CASCADE IS THE INTEGRITY MECHANISM, AND IT IS NOT THE ONLY ONE. Choosing a
 * province clears both children, and choosing a locality clears the barangay, so
 * a child can never be left attached to a new parent. But the client is UX: the
 * server re-resolves the triple against the provider before it believes it, and a
 * hand-crafted request body proves nothing.
 *
 * NAMES COME FROM THE PROVIDER AND ARE NOT REWRITTEN. This block does not
 * upper-case, title-case or otherwise "tidy" a geographic name, because the
 * authority's spelling is the record. What IS written back is whatever the
 * provider returned, never what the browser typed.
 *
 * Legacy records - a stored free-text province with no code - render exactly as
 * they are and are flagged as unverified. No code is invented for them, and their
 * absence of a code is not a reason to refuse to save.
 */
import { Combobox, type ComboboxOption } from '@afhomes/ui';
import { useState } from 'react';

import { useBarangaysQuery, useLocalitiesQuery, useProvincesQuery } from './useAddressHierarchy.js';

/**
 * The geographic slice of a holder. Codes and names are carried separately:
 * the codes are the verified identity, the names are what a human reads.
 * `undefined` throughout is a legitimate state - a legacy record.
 */
export interface AddressGeography {
  province?: string;
  provinceCode?: string;
  cityMunicipality?: string;
  cityMunicipalityCode?: string;
  barangay?: string;
  barangayCode?: string;
}

export interface GeographicAddressFieldsProps {
  idPrefix: string;
  value: AddressGeography;
  onChange: (next: AddressGeography) => void;
  disabled?: boolean;
}

/** An empty slice: every code cleared, ready to be filled from the top. */
const clearedBelow = (): AddressGeography => ({
  cityMunicipality: undefined,
  cityMunicipalityCode: undefined,
  barangay: undefined,
  barangayCode: undefined,
});

/**
 * Show a stored name even when it has no code. The empty code marks it
 * unverified, and the combobox never invents one.
 */
const shownAs = (code: string | undefined, name: string | undefined): ComboboxOption | null =>
  name ? { code: code ?? '', name } : null;

export function GeographicAddressFields({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: GeographicAddressFieldsProps) {
  /**
   * A loaded record already has its province, so show it without asking. Only a
   * blank province needs the list, and only once the operator reaches for it.
   */
  const [provinceOpened, setProvinceOpened] = useState(false);
  const provinces = useProvincesQuery(disabled ? false : provinceOpened || Boolean(value.province));
  const localities = useLocalitiesQuery(disabled ? undefined : value.provinceCode);
  const barangays = useBarangaysQuery(disabled ? undefined : value.cityMunicipalityCode);

  const provinceOption = shownAs(value.provinceCode, value.province);
  const localityOption = shownAs(value.cityMunicipalityCode, value.cityMunicipality);
  const barangayOption = shownAs(value.barangayCode, value.barangay);

  /** A level is only usable once its parent has a VERIFIED code. Locked levels
      stay hint-free: the parent selector above already says what to do. */
  const localityUnlocked = Boolean(value.provinceCode) && !disabled;
  const barangayUnlocked = Boolean(value.cityMunicipalityCode) && !disabled;

  return (
    <>
      <Combobox
        id={`${idPrefix}-province`}
        label="Province"
        required
        disabled={disabled}
        onOpen={() => setProvinceOpened(true)}
        loadingLabel="Loading provinces"
        error={provinces.isError ? 'Unable to load provinces. Try again.' : null}
        onRetry={() => void provinces.refetch()}
        // `isFetching`, not `isPending`: a query that is not enabled (nothing has
        // been typed and no record was loaded) stays `isPending` forever in v5,
        // which would announce a load that was never started.
        loading={provinces.isFetching}
        value={provinceOption}
        options={provinces.data ?? []}
        onSelect={(option) =>
          onChange({
            province: option?.name,
            provinceCode: option?.code || undefined,
            ...clearedBelow(),
          })
        }
      />
      {value.province && !value.provinceCode ? <Unverified /> : null}

      <Combobox
        id={`${idPrefix}-locality`}
        label="City / municipality"
        required
        disabled={!localityUnlocked}
        loading={localities.isFetching}
        loadingLabel="Loading cities and municipalities"
        error={
          Boolean(value.provinceCode) && localities.isError
            ? 'Unable to load cities and municipalities. Try again.'
            : null
        }
        onRetry={() => void localities.refetch()}
        value={localityOption}
        options={localities.data ?? []}
        onSelect={(option) =>
          onChange({
            province: value.province,
            provinceCode: value.provinceCode,
            cityMunicipality: option?.name,
            cityMunicipalityCode: option?.code || undefined,
            barangay: undefined,
            barangayCode: undefined,
          })
        }
      />
      {value.cityMunicipality && !value.cityMunicipalityCode ? <Unverified /> : null}

      <Combobox
        id={`${idPrefix}-barangay`}
        label="Barangay"
        required
        disabled={!barangayUnlocked}
        loading={barangays.isFetching}
        loadingLabel="Loading barangays"
        error={
          Boolean(value.cityMunicipalityCode) && barangays.isError
            ? 'Unable to load barangays. Try again.'
            : null
        }
        onRetry={() => void barangays.refetch()}
        value={barangayOption}
        options={barangays.data ?? []}
        onSelect={(option) =>
          onChange({
            province: value.province,
            provinceCode: value.provinceCode,
            cityMunicipality: value.cityMunicipality,
            cityMunicipalityCode: value.cityMunicipalityCode,
            barangay: option?.name,
            barangayCode: option?.code || undefined,
          })
        }
      />
      {value.barangay && !value.barangayCode ? <Unverified /> : null}
    </>
  );
}

/**
 * Says why a stored address is not code-verified. Absence is expected for every
 * application created before the structured selectors existed, so this is
 * information, not an error - it must not block saving.
 */
function Unverified() {
  return (
    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
      Stored value, not linked to an official code yet - pick it from the list to verify.
    </p>
  );
}
