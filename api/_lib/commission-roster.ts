import { commissionRosterQuerySchema, commissionRosterSchema } from '@afhomes/contracts';
import { readSearchRows, matchesSearch } from './list-search.js';
import { isoOrNull, type Db } from './handler-kit.js';

const SELLERS = ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'];
/** Current rate preview only; existing commission snapshots are never recomputed. */
export async function commissionRoster(db: Db, input: unknown) {
  const query = commissionRosterQuerySchema.parse(input);
  const [roles, assignments, staff, ost, sales, rules] = await Promise.all([
    readSearchRows(db.from('roles').select('id,slug,name,is_active').order('id')),
    readSearchRows(db.from('staff_role_assignments').select('staff_id,role_id').order('staff_id')),
    readSearchRows(
      db
        .from('staff_users')
        .select('id,full_name,email,employee_number,status,activated_at,created_at')
        .eq('status', 'active')
        .order('id'),
    ),
    readSearchRows(db.from('ost_members').select('id,status,approved_at').order('id')),
    readSearchRows(
      db
        .from('card_sales')
        .select('id,seller_staff_id,seller_ost_id,status,created_at')
        .order('id'),
    ),
    readSearchRows(
      db
        .from('commission_rules')
        .select('*')
        .eq('is_active', true)
        .order('effective_from', { ascending: false })
        .order('id'),
    ),
  ]);
  const positions = roles.filter((r) => SELLERS.includes(String(r.slug)) && r.is_active !== false);
  const today = new Date().toISOString().slice(0, 10);
  const effective = rules.filter(
    (r) =>
      String(r.effective_from).slice(0, 10) <= today &&
      (!r.effective_until || String(r.effective_until).slice(0, 10) >= today),
  );
  const everyone = staff.flatMap((person) => {
    const assignment = assignments.find((a) => a.staff_id === person.id);
    const role = positions.find((r) => r.id === assignment?.role_id);
    if (!role) return [];
    const ostMember =
      role.slug === 'ost' ? ost.find((o) => o.id === person.id && o.status === 'active') : null;
    if (role.slug === 'ost' && !ostMember) return [];
    const accredited = isoOrNull(
      ostMember ? ostMember.approved_at : (person.activated_at ?? person.created_at),
    )?.slice(0, 10);
    const eligible = effective.filter(
      (r) =>
        !r.accredited_on_or_after ||
        (accredited && accredited >= String(r.accredited_on_or_after).slice(0, 10)),
    );
    const personal = eligible.find(
      (r) => r.target_type === (ostMember ? 'ost' : 'staff') && r.target_id === person.id,
    );
    const rule =
      personal ?? eligible.find((r) => r.target_type === 'role' && r.target_id === role.id);
    const activity = sales.filter(
      (s) =>
        s.status !== 'cancelled' &&
        (s.seller_staff_id === person.id || s.seller_ost_id === person.id),
    );
    const lastSaleAt =
      activity
        .map((s) => isoOrNull(s.created_at))
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null;
    return [
      {
        id: String(person.id),
        name: String(person.full_name ?? ''),
        positionSlug: String(role.slug),
        positionName: String(role.name),
        salesCount: activity.length,
        lastSaleAt,
        rate: String(rule?.rate ?? '0'),
        source: rule ? (personal ? 'custom' : 'position') : 'none',
        ruleId: rule ? String(rule.id) : null,
        searchText: [person.full_name, person.email, person.employee_number],
      },
    ];
  });
  const needs = (p: (typeof everyone)[number]) => p.salesCount > 0 && p.source === 'none';
  const filtered = everyone
    .filter(
      (p) =>
        matchesSearch(query.search, p.searchText) &&
        (!query.position || p.positionSlug === query.position) &&
        (query.sales === 'all' ||
          (query.sales === 'with' ? p.salesCount > 0 : p.salesCount === 0)) &&
        (query.needsRate !== 'true' || needs(p)),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return commissionRosterSchema.parse({
    positions: positions.map((r) => {
      const rule = effective.find((rule) => rule.target_type === 'role' && rule.target_id === r.id);
      return {
        roleId: r.id,
        slug: r.slug,
        name: r.name,
        memberCount: everyone.filter((p) => p.positionSlug === r.slug).length,
        defaultRuleId: rule?.id ?? null,
        defaultRate: rule?.rate ?? null,
      };
    }),
    members: filtered.slice(query.offset, query.offset + query.limit),
    total: filtered.length,
    offset: query.offset,
    limit: query.limit,
    needsRateCount: everyone.filter(needs).length,
  });
}
