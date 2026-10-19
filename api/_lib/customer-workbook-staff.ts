import { aaNumberSchema } from '@afhomes/contracts';
import { z } from 'zod';
import type { Db } from './handler-kit.js';
import { storedAccreditationNumbers } from './accreditation-numbers.js';
import type { WorkbookStaffMatch } from './customer-workbook.js';

const fields = ['vd_name', 'ssm_name', 'sm_name', 'referrer_name', 'recommender_name'];

/** Read existing identities only; identifiers narrow candidates, never create members. */
export async function loadWorkbookStaffMatches(
  db: Db,
  rows: { fields: Record<string, string> }[],
): Promise<WorkbookStaffMatch[]> {
  const references = [
    ...new Set(
      rows.flatMap((row) => fields.map((field) => row.fields[field]?.trim() ?? '')).filter(Boolean),
    ),
  ];
  if (!references.length) return [];
  const names = new Set<string>();
  const ids: string[] = [];
  for (const reference of references) {
    if (z.uuid().safeParse(reference).success) ids.push(reference);
    else if (aaNumberSchema.safeParse(reference.toUpperCase()).success) {
      // shortcut: AA-only search covers current accreditation; use a staff UUID for expired records until a private identifier lookup is approved.
      const result = await db.rpc('search_sale_team_accreditation', {
        p_aa_number: reference.toUpperCase(),
      });
      if (result.error) throw result.error;
      const record = Array.isArray(result.data) ? result.data[0] : result.data;
      if (record?.fullName) names.add(record.fullName);
    } else names.add(reference);
  }
  const readNames = async (staffIds: string[]) => {
    for (let offset = 0; offset < staffIds.length; offset += 200) {
      const result = await db
        .from('staff_users')
        .select('id,full_name')
        .in('id', staffIds.slice(offset, offset + 200));
      if (result.error) throw result.error;
      for (const staff of result.data ?? []) names.add(String(staff.full_name));
    }
  };
  await readNames(ids);
  const matches = new Map<string, WorkbookStaffMatch>();
  const readMatches = async (inputs: string[]) => {
    for (let offset = 0; offset < inputs.length; offset += 200) {
      const result = await db.rpc('match_company_import_staff', {
        p_names: inputs.slice(offset, offset + 200),
      });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data) || result.data.length >= 1000)
        throw new Error(
          'Registered identity lookup is incomplete; narrow the workbook before retrying.',
        );
      for (const match of result.data as WorkbookStaffMatch[])
        matches.set(`${match.staff_id}:${match.role_slug}`, match);
    }
  };
  await readMatches([...names]);
  const ancestors = [...new Set([...matches.values()].flatMap((match) => match.ancestor_ids))];
  await readNames(ancestors);
  await readMatches([...names]);
  const numbers = await storedAccreditationNumbers(
    db,
    [...matches.values()].map((match) => match.staff_id),
  );
  return [...matches.values()].map((match) => ({
    ...match,
    aa_number: numbers.get(match.staff_id) ?? null,
  }));
}
