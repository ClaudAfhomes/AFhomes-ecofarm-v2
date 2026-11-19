import type { serviceClient } from './rest.js';

export type SponsorCheck =
  | { ok: true; id: string; fullName: string; email: string }
  | { ok: false; status: 403 | 404 | 409; message: string };

/**
 * Public referral sponsors may be VD/SSM/SM. Manual registration requires SM;
 * SQL additionally validates its complete upperline and the actor's scope.
 */
export async function validateOstSponsor(
  db: NonNullable<ReturnType<typeof serviceClient>>,
  sponsorStaffId: string,
  context: 'referral' | 'manual' = 'referral',
): Promise<SponsorCheck> {
  const { data: staff, error: staffError } = await db
    .from('staff_users')
    .select('id, full_name, email, status')
    .eq('id', sponsorStaffId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff) return { ok: false, status: 404, message: 'Sponsor not found' };
  if (staff.status !== 'active')
    return { ok: false, status: 409, message: 'The sponsoring seller is not active' };
  const { data: assignment, error: assignmentError } = await db
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', sponsorStaffId)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment?.role_id)
    return { ok: false, status: 409, message: 'Sponsor holds no sales role' };
  const { data: role, error: roleError } = await db
    .from('roles')
    .select('slug, is_active')
    .eq('id', assignment.role_id)
    .maybeSingle();
  if (roleError) throw roleError;
  const eligible = context === 'manual'
    ? role?.slug === 'sales_manager'
    : ['vice_director', 'senior_sales_manager', 'sales_manager'].includes(role?.slug);
  if (!role?.is_active || !eligible)
    return { ok: false, status: 409, message: context === 'manual'
      ? 'Choose an active Sales Manager for manual registration'
      : 'Referrals require an active VD, SSM or Sales Manager' };
  return {
    ok: true,
    id: String(staff.id),
    fullName: String(staff.full_name),
    email: String(staff.email),
  };
}
