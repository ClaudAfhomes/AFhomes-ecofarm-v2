import { readFileSync } from 'node:fs';
import { resolvePostalCode } from './postal-reference.js';

type AddressSnapshot = {
  source: string;
  retrievedAt: string;
  provinces: string[];
  localities: { province: string; name: string; barangays: string[] }[];
};
const snapshot = JSON.parse(
  readFileSync(
    new URL('../../packages/contracts/assets/customer-workflow-addresses.json', import.meta.url),
    'utf8',
  ),
) as AddressSnapshot;
const column = (n: number): string =>
  n > 26
    ? column(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26))
    : String.fromCharCode(64 + n);

/** A pinned snapshot of the application's provider; live preview still rechecks ancestry. */
export function workflowAddressLists() {
  const rows: string[][] = [['Address group', 'List reference', 'Choices']];
  const definedNames: { name: string; formula: string }[] = [
    { name: 'AFHomesEmpty', formula: "'Address Lists'!$D$1" },
    {
      name: 'AFHomesProvinces',
      formula: `'Address Lists'!$A$2:$A$${snapshot.provinces.length + 1}`,
    },
  ];
  const append = (key: string, name: string, choices: string[]) => {
    rows.push([key, name, ...choices]);
    definedNames.push({
      name,
      formula: `'Address Lists'!$C$${rows.length}:$${column(Math.max(3, choices.length + 2))}$${rows.length}`,
    });
  };
  snapshot.provinces.forEach((province, i) =>
    append(
      province,
      `AFHomesCities${i}`,
      snapshot.localities.filter((c) => c.province === province).map((c) => c.name),
    ),
  );
  const provinceEnd = rows.length;
  definedNames.push({ name: 'AFHomesProvinceLookup', formula: `'Address Lists'!$A$2:$B$${provinceEnd}` });
  const postalRows: string[][] = [['Address', 'Verified postal code']];
  snapshot.localities.forEach((city, i) => {
    append(`${city.province}|${city.name}`, `AFHomesBarangays${i}`, city.barangays);
    const main = resolvePostalCode(city.province, city.name);
    if (main.status === 'matched')
      postalRows.push([`${city.province}|${city.name}`, main.postalCode]);
    for (const barangay of city.barangays) {
      const exact = resolvePostalCode(city.province, city.name, barangay);
      if (
        exact.status === 'matched' &&
        (main.status !== 'matched' || exact.postalCode !== main.postalCode)
      )
        postalRows.push([`${city.province}|${city.name}|${barangay}`, exact.postalCode]);
    }
  });
  definedNames.push({ name: 'AFHomesLocalityLookup', formula: `'Address Lists'!$A$${provinceEnd + 1}:$B$${rows.length}` });
  return {
    rows,
    postalRows,
    definedNames,
    provinceEnd,
    localityStart: provinceEnd + 1,
    source: snapshot.source,
    retrievedAt: snapshot.retrievedAt,
  };
}
