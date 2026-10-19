import { describe, expect, it } from 'vitest';
import { resolveWorkbookStaff, type WorkbookStaffMatch } from './customer-workbook.js';
import { validateImportRow } from './customer-import.js';
import { loadWorkbookStaffMatches } from './customer-workbook-staff.js';
import { FakeSupabase } from './testing/supabase-fake.js';

const registered: WorkbookStaffMatch[] = [
  {
    staff_id: 'vd',
    full_name: 'Synthetic VD',
    role_slug: 'vice_director',
    ancestor_ids: [],
    match_count: 1,
  },
  {
    staff_id: 'ssm',
    full_name: 'Synthetic SSM',
    role_slug: 'senior_sales_manager',
    ancestor_ids: ['vd'],
    match_count: 1,
  },
  {
    staff_id: 'sm',
    full_name: 'Synthetic SM',
    role_slug: 'sales_manager',
    ancestor_ids: ['ssm', 'vd'],
    match_count: 1,
  },
  {
    staff_id: 'other-sm',
    full_name: 'Other SM',
    role_slug: 'sales_manager',
    ancestor_ids: ['ssm', 'vd'],
    match_count: 1,
  },
  {
    staff_id: 'ref',
    full_name: 'Synthetic Referrer',
    role_slug: 'ost',
    ancestor_ids: ['sm', 'ssm', 'vd'],
    match_count: 1,
    aa_number: 'AAO26100001',
  },
  {
    staff_id: 'vip',
    full_name: 'Synthetic VIP',
    role_slug: 'ost',
    ancestor_ids: ['other-sm', 'ssm', 'vd'],
    match_count: 1,
    aa_number: 'AAO26100002',
  },
];
function preview(over: Record<string, string> = {}, matches = registered) {
  const fields: Record<string, string> = {
    first_name: 'Synthetic',
    last_name: 'Customer',
    email: 'synthetic@example.invalid',
    mobile: '09123456789',
    source_status: 'Pending',
    workbook_format: 'company_v1',
    vd_name: 'Synthetic VD',
    ssm_name: 'Synthetic SSM',
    sm_name: 'Synthetic SM',
    referrer_name: 'Synthetic Referrer',
    recommender_name: 'Synthetic VIP',
    ...over,
  };
  const row = validateImportRow(
    2,
    fields,
    {
      plansByTier: new Map(),
      customerByNumber: new Map(),
      customerByEmail: new Map(),
      membershipByNumber: new Map(),
      referralStaffByCode: new Map(),
      seenMembershipNumbers: new Map(),
    },
    '2026-10-19',
  );
  resolveWorkbookStaff(fields, matches, row);
  return { fields, row };
}
describe('registered OST workbook validation', () => {
  it('resolves a canonical staff UUID case-insensitively', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const result = preview(
      { recommender_name: id.toUpperCase() },
      registered.map((m) => (m.staff_id === 'vip' ? { ...m, staff_id: id } : m)),
    );
    expect(result.row.errors).toEqual([]);
    expect(result.fields.recommender_staff_id).toBe(id);
  });
  it('does not adopt a name-only candidate when the database reports other matches', () => {
    const result = preview(
      {},
      registered.map((m) => (m.staff_id === 'vip' ? { ...m, match_count: 2 } : m)),
    );
    expect(result.fields.recommender_staff_id).toBeUndefined();
    expect(
      result.row.errors.some((e) => e.field === 'recommender_name' && /ambiguous/.test(e.message)),
    ).toBe(true);
  });
  it('loads both registered OST identities, their separate ancestors and AAOs using read-only queries', async () => {
    const db = new FakeSupabase({
      tables: { staff_users: registered.map((m) => ({ id: m.staff_id, full_name: m.full_name })) },
      rpcs: [
        {
          fn: 'match_company_import_staff',
          result: (args: Record<string, unknown>) =>
            registered.filter((m) => (args.p_names as string[]).includes(m.full_name)),
        },
        {
          fn: 'get_sale_team_accreditation',
          result: (args: Record<string, unknown>) => {
            const member = registered.find((m) => m.staff_id === args.p_staff_id);
            return member?.aa_number
              ? {
                  aaNumber: member.aa_number,
                  kind: 'OST',
                  fullName: member.full_name,
                  status: 'accredited',
                  startsOn: '2026-01-01',
                  expiresOn: '2027-01-01',
                }
              : null;
          },
        },
        { fn: 'search_sale_team_accreditation', result: { fullName: 'Synthetic VIP' } },
      ],
    });
    const matches = await loadWorkbookStaffMatches(db as never, [
      { fields: { referrer_name: 'Synthetic Referrer', recommender_name: 'AAO26100002' } },
    ]);
    expect(matches).toHaveLength(6);
    const result = preview({ recommender_name: 'AAO26100002' }, matches);
    expect(result.row.errors).toEqual([]);
    expect(result.fields.recommender_staff_id).toBe('vip');
    expect(result.fields.recommender_name).toBe('Synthetic VIP');
    expect(result.fields.recommender_reference).toBe('AAO26100002');
    expect(
      db.calls.filter((c) =>
        ['insert', 'update', 'delete', 'createUser', 'inviteUserByEmail'].includes(c.op),
      ),
    ).toEqual([]);
  });
  it('fails closed when registered accreditation lookup fails', async () => {
    const db = new FakeSupabase({
      rpcs: [{ fn: 'match_company_import_staff', result: registered }],
      rpcErrors: { get_sale_team_accreditation: { message: 'Synthetic outage' } },
    });
    await expect(
      loadWorkbookStaffMatches(db as never, [{ fields: { referrer_name: 'Synthetic Referrer' } }]),
    ).rejects.toMatchObject({ message: 'Synthetic outage' });
  });
  it('resolves both OSTs in one tree with different immediate uplines', () => {
    const { fields, row } = preview();
    expect(row.errors).toEqual([]);
    expect(fields).toMatchObject({
      referrer_staff_id: 'ref',
      recommender_staff_id: 'vip',
      referrer_sm_staff_id: 'sm',
      recommender_sm_staff_id: 'other-sm',
    });
    expect(row.warnings.some((w) => /same.*tree/i.test(w.message))).toBe(true);
  });
  it.each(['vd', 'ssm', 'sm'])(
    'uses the actual direct %s placement without inventing missing upperlines',
    (head) => {
      const ancestors =
        head === 'vd' ? ['vd'] : head === 'ssm' ? ['ssm', 'vd'] : ['sm', 'ssm', 'vd'];
      const { fields, row } = preview(
        {
          sm_name: head === 'sm' ? 'Synthetic SM' : '',
          ssm_name: head === 'vd' ? '' : 'Synthetic SSM',
        },
        registered.map((m) => (m.staff_id === 'ref' ? { ...m, ancestor_ids: ancestors } : m)),
      );
      expect(row.errors).toEqual([]);
      expect(fields.referrer_sm_staff_id ?? '').toBe(head === 'sm' ? 'sm' : '');
    },
  );
  it.each(['Unknown OST', 'Synthetic SM'])(
    'rejects a missing or wrong-role VIP Recommender: %s',
    (name) => {
      expect(
        preview({ recommender_name: name }).row.errors.some((e) => e.field === 'recommender_name'),
      ).toBe(true);
    },
  );
  it('shows a specific supplied SM versus registered Referrer lineage conflict', () => {
    const { row } = preview({ sm_name: 'Other SM' });
    expect(
      row.errors.some((e) => /Synthetic SM/.test(e.message) && /Other SM/.test(e.message)),
    ).toBe(true);
  });
  it('rejects two separate VD roots even when each identity exists', () => {
    const matches = [
      ...registered,
      { ...registered[0]!, staff_id: 'vd2', full_name: 'Other VD' },
    ].map((m) => (m.staff_id === 'vip' ? { ...m, ancestor_ids: ['vd2'] } : m));
    expect(
      preview({}, matches).row.errors.some(
        (e) => e.field === 'recommender_name' && /different.*tree/i.test(e.message),
      ),
    ).toBe(true);
  });
  it('uses an AAO to disambiguate duplicate names and keeps the database confirmation hold explicit', () => {
    const matches = [
      ...registered.map((m) =>
        m.staff_id === 'vip' ? { ...m, full_name: 'Duplicate OST', match_count: 2 } : m,
      ),
      {
        ...registered[5]!,
        staff_id: 'duplicate',
        full_name: 'Duplicate OST',
        match_count: 2,
        aa_number: 'AAO26100003',
      },
    ];
    const { fields, row } = preview({ recommender_name: 'AAO26100002' }, matches);
    expect(fields.recommender_staff_id).toBe('vip');
    expect(row.errors.some((e) => /ambiguous.*identity/i.test(e.message))).toBe(false);
    expect(row.errors.some((e) => /confirmation.*name/i.test(e.message))).toBe(true);
  });
  it('rejects duplicate names without a canonical identifier', () => {
    const matches = [
      ...registered,
      { ...registered[5]!, staff_id: 'duplicate', aa_number: 'AAO26100003' },
    ];
    expect(
      preview({}, matches).row.errors.some(
        (e) => e.field === 'recommender_name' && /staff ID|AAO/.test(e.message),
      ),
    ).toBe(true);
  });
  it('rejects incomplete and cyclic genealogy rather than filling gaps', () => {
    for (const ancestors of [
      ['missing', 'vd'],
      ['sm', 'ref', 'vd'],
      ['sm', 'sm', 'vd'],
    ])
      expect(
        preview(
          {},
          registered.map((m) => (m.staff_id === 'ref' ? { ...m, ancestor_ids: ancestors } : m)),
        ).row.errors.some((e) => e.field === 'referrer_name'),
      ).toBe(true);
  });
});
