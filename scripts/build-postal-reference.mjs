import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Pinned source: the repository's "Update LICENSE" commit of 2024-01-04. The
// version-2.sql bytes are identical to the earlier d06ed28 commit (same
// SHA-256, verified when this pin was chosen), but that earlier commit's
// LICENSE file is GPL-3.0 while this pinned commit carries the MIT license
// shipped beside the compiled artifact. Data: Grit (grit.ph/zip-codes), 2024-01-04.
const PINNED_COMMIT = '4ee5485c70430eda4f4060575230b326ab391b71';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
// Parse literal data only. Never execute the downloaded MySQL dump.
const response = await fetch(
  `https://raw.githubusercontent.com/simonpangan/Philippines-Zip-Codes/${PINNED_COMMIT}/version-2.sql`,
);
if (!response.ok) throw Error('Postal source download failed');
const sql = await response.text();
if (sha256(sql) !== '48f46477b297f6e296e615a82bc5de209fb2ee8fd944983f38ff7762f0c5b394')
  throw Error('Postal source hash mismatch');
// The shipped LICENSE must BE the pinned commit's LICENSE byte-for-byte, so the
// artifact and the license text that covers it cannot drift apart.
const license = await fetch(
  `https://raw.githubusercontent.com/simonpangan/Philippines-Zip-Codes/${PINNED_COMMIT}/LICENSE`,
);
if (!license.ok) throw Error('Postal license download failed');
if ((await license.text()) !== readFileSync('packages/contracts/assets/postal/LICENSE', 'utf8'))
  throw Error('Postal license mismatch');
const sections = (table) =>
  [...sql.matchAll(new RegExp('INSERT INTO `' + table + '`[^;]+;', 'g'))].map((m) => m[0]);
const names = (table, province = false) =>
  new Map(
    sections(table).flatMap((section) =>
      [
        ...section.matchAll(
          province ? /\((\d+), \d+, '((?:[^']|'')*)'\)/g : /\((\d+), '((?:[^']|'')*)'\)/g,
        ),
      ].map((m) => [m[1], m[2].replace(/''/g, "'")]),
    ),
  );
const provinces = names('provinces', true),
  cities = names('ncr_cities');
// Canonical-spelling corrections for locality names. The source mis-spells
// Marikina ("Markina City") and splits Caloocan City into its two POSTAL
// DISTRICTS as parenthetical city names, which stops every city+barangay
// lookup for Caloocan (its districts carry the codes). These are spelling/
// canonical fixes, never district inference: the district column already
// carries each district. Deliberately NOT renamed here: province names (the
// resolver maps current PSGC spellings; see api/_lib/postal-reference.ts) and
// "Datu Odin Sinsuat (Dinaig)" (former-name suffix, left as a review hold).
const localityNames = {
  'Markina City': 'Marikina City',
  'Caloocan City (North)': 'Caloocan City',
  'Caloocan City (South)': 'Caloocan City',
};
const rows = [];
for (const table of ['province_locations', 'ncr_locations'])
  for (const section of sections(table))
    for (const match of section.matchAll(/\(\d+, (\d+), '((?:[^']|'')*)', '(\d{4})', '[^']*'\)/g)) {
      const parent = (table === 'province_locations' ? provinces : cities).get(match[1]);
      if (!parent) throw Error('Missing parent');
      const locality = (table === 'province_locations' ? match[2] : parent).replace(/''/g, "'");
      const canonical = localityNames[locality] ?? locality;
      rows.push(
        table === 'province_locations'
          ? [parent, canonical, '', match[3]]
          : ['Metro Manila', canonical, match[2].replace(/''/g, "'"), match[3]],
      );
    }
// Audited against https://phlpost.gov.ph/zip-code-locator/ on 2026-10-16.
const corrections = [
  ['Masbate', 'Cawayan', '5409'], ['Camarines Norte', 'Capalonga', '4607'],
  ['Albay', 'Oas', '4505'], ['Surigao del Sur', 'Cagwait', '8304'],
  ['Cagayan', 'Gonzaga', '3513'], ['Cagayan', 'Alcala', '3507'],
];
for (const row of rows) {
  const correction = corrections.find(([province, locality]) => row[0].toLowerCase() === province.toLowerCase() && row[1] === locality && !row[2]);
  if (correction) row[3] = correction[2];
}
const unique = [...new Map(rows.map((row) => [JSON.stringify(row), row])).values()].sort((a, b) =>
  JSON.stringify(a).localeCompare(JSON.stringify(b)),
);
console.log(
  JSON.stringify({
    rows: unique.length,
    provinces: new Set(unique.map((r) => r[0])).size,
    ncrCities: [...new Set(unique.filter((r) => r[0] === 'Metro Manila').map((r) => r[1]))],
    examples: unique.filter((r) => r[0] === 'Laguna' && ['Victoria', 'Calauan'].includes(r[1])),
  }),
);
mkdirSync('packages/contracts/assets/postal', { recursive: true });
if (unique.length !== 1974) throw Error('Unexpected postal row count');
writeFileSync(
  'packages/contracts/assets/postal/national-reference.json',
  JSON.stringify(unique) + '\n',
);
