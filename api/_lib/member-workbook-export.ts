import { z } from 'zod';
import {
  memberWorkbookDisplayName,
  memberWorkbookLocalMobile,
  type Member,
  type MemberWorkbookKind,
} from '@afhomes/contracts';
import { companyMemberWorkbook, memberHeadLabel } from './member-company-workbook.js';
import { COMPANY_ID_TYPES, COMPANY_ROLES } from './member-workbook-layout.js';
import type { Db } from './handler-kit.js';

export async function exportMemberWorkbook(
  db: Db,
  actorId: string,
  kind: MemberWorkbookKind,
  members: Member[],
) {
  const selected = members.filter((m) =>
    kind === 'OST' ? m.position === 'ost' : m.position !== 'ost',
  );
  if (selected.length > 500)
    throw new Error('Export supports 500 members; narrow the authorized roster.');
  const result = await db.rpc('export_member_workbook_profiles', {
    p_actor: actorId,
    p_ids: selected.map((m) => m.id),
  });
  if (result.error)
    throw new Error('Safe sectioned export requires the reviewed import migration.');
  const detail = z
    .array(
      z.object({
        id: z.uuid(),
        fields: z.record(z.string(), z.string().nullable()),
        history: z.array(
          z.object({
            startsOn: z.string(),
            expiresOn: z.string(),
            status: z.string(),
            approvedAt: z.string(),
          }),
        ),
      }),
    )
    .parse(result.data);
  if (
    detail.length !== selected.length ||
    new Set(detail.map((d) => d.id)).size !== selected.length
  )
    throw new Error('Unable to verify complete export details.');
  const history: string[] = [];
  const entries = selected.map((member) => {
    const extra = detail.find((d) => d.id === member.id);
    if (!extra) throw new Error('Missing export profile.');
    const words = member.fullName.split(/\s+/);
    const f: Record<string, string> = {
      aa_number: member.aaNumber ?? '',
      first_name: words.slice(0, -1).join(' ') || member.fullName,
      middle_name: '',
      last_name: words.length > 1 ? words.at(-1)! : '',
      email: member.email,
      mobile: member.mobileNo ?? '',
      birth_date: member.dateOfBirth ?? '',
      sex: member.sex ?? '',
      civil_status: member.civilStatus ?? '',
      province: member.province ?? '',
      city: member.cityMunicipality ?? '',
      barangay: '',
      address_line_1: member.streetNo ?? '',
      postal_code: member.zipCode ?? '',
      telephone: member.telNo ?? '',
      messenger: member.fbMessenger ?? '',
      employer_name: member.employerName ?? '',
      employer_address: member.employerAddress ?? '',
      job_position: member.jobPosition ?? '',
      government_id_type: member.governmentIdType ?? '',
    };
    for (const [field, value] of Object.entries(extra.fields)) if (value !== null) f[field] = value;
    for (const field of ['first_name', 'middle_name', 'last_name'])
      f[field] = memberWorkbookDisplayName(f[field] ?? '');
    f.mobile = memberWorkbookLocalMobile(f.mobile ?? '');
    for (const field of ['sex', 'civil_status'])
      if (f[field]) f[field] = memberWorkbookDisplayName(f[field]!);
    f.position =
      Object.entries(COMPANY_ROLES).find(([, role]) => role === member.position)?.[0] ?? '';
    const parent = members.find((m) => m.id === member.referrerStaffId);
    f.head_member = parent ? memberHeadLabel(parent) : '';
    f.head_role = parent
      ? (Object.entries(COMPANY_ROLES).find(([, role]) => role === parent.position)?.[0] ?? '')
      : '';
    f.government_id_type =
      Object.entries(COMPANY_ID_TYPES).find(([, value]) => value === f.government_id_type)?.[0] ??
      f.government_id_type!;
    // Restricted values are omitted even if a future projection accidentally includes them.
    delete f.tin;
    delete f.government_id_number;
    for (const term of extra.history)
      history.push(
        `${member.aaNumber ?? member.id} — recorded OST term ${term.startsOn} to ${term.expiresOn}; ${term.status}; recorded approval ${term.approvedAt}. Historical claims are not proof of a new renewal.`,
      );
    return f;
  });
  return companyMemberWorkbook(kind, members, entries, history);
}
