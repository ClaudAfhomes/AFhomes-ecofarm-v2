import type { serviceClient } from './rest.js';

export type SponsorCheck =
  | { ok: true; id: string; fullName: string; email: string }
  | { ok: false; status: 403 | 404 | 409; message: string };

/**
 * OST sponsorship validation: the sponsor of an OST referral code must be an
 * ACTIVE SALES MANAGER holding an active role.
 *
 * This rule belongs ONLY to the OST sponsorship context (public code
 * resolution, public application submission, and the approval re-check),
 * because an approved OST is inserted into the genealogy as `ost` directly
 * under a `sales_manager`. It must never be reused for customer/card-sale
 * referrals or for generic referral-code issuance - those contexts have
 * their own validators below.
 */
export async function validateOstSponsor(
  db: NonNullable<ReturnType<typeof serviceClient>>,
  sponsorStaffId: string,
): Promise<SponsorCheck> {
  const { data: staff, error: staffError } = await db
    .from('staff_users')
    .select('id, full_name, email, status')
    .eq('id', sponsorStaffId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff) return { ok: false, status: 404, message: 'Sponsor not found' };
  if (staff.status !== 'active')
    return { ok: false, status: 409, message: 'The sponsoring Sales Manager is not active' };
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
  if (!role?.is_active || role.slug !== 'sales_manager')
    return { ok: false, status: 409, message: 'Referrals must come from an active Sales Manager' };
  return {
    ok: true,
    id: String(staff.id),
    fullName: String(staff.full_name),
    email: String(staff.email),
  };
}
