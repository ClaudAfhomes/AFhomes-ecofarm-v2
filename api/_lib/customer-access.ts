/**
 * AF Homes customer principal resolver.
 *
 * This is DELIBERATELY SEPARATE from `afhomes-access.ts`. A customer principal
 * is derived from ownership, never from the staff permission model:
 *
 *     Supabase JWT -> customers.auth_user_id -> customer -> membership
 *
 * Nothing here consults `staff_users`, `staff_role_assignments`, `roles`,
 * `role_permissions` or `modules`. A signed-in customer therefore cannot reach a
 * staff capability by any route, and a staff account gains no customer
 * capability here even if it also happens to hold a customer record: the two
 * authorisation systems never meet.
 *
 * The principal is re-resolved on EVERY request. There is no cache, so a
 * suspension takes effect on the very next call with no client cooperation.
 */
import { toErrorEnvelope } from './envelope.js';
import { extractBearerToken } from './token.js';
import { anonClient, serviceClient } from './rest.js';
import type { VercelRequest } from './http.js';

type Db = ReturnType<typeof serviceClient>;

export type CustomerStatus = 'prospect' | 'active' | 'suspended' | 'cancelled';

export type CustomerPrincipal = {
  /** The Supabase Auth user id. */
  userId: string;
  customerId: string;
  customerNumber: string;
  email: string;
  status: CustomerStatus;
};

export type CustomerDenial = {
  error: { error: { code: string; message: string }; status: number };
};

const deny = (code: string, message: string, status: number): CustomerDenial => ({
  error: toErrorEnvelope(code, message, status),
});

/**
 * Resolve the customer behind a request. Returns a denial instead of throwing so
 * handlers can relay the exact status and code to the client.
 */
export async function resolveCustomerPrincipal(
  req: VercelRequest,
): Promise<CustomerPrincipal | CustomerDenial> {
  const token = extractBearerToken(req);
  if (!token) return deny('UNAUTHORIZED', 'Sign in to continue', 401);

  const anon = anonClient();
  const svc = serviceClient() as Db;
  if (!anon || !svc) {
    return deny('INTERNAL', 'Server configuration is incomplete', 500);
  }

  const { data: authData, error: authError } = await anon.auth.getUser(token);
  const user = authData?.user as { id?: string } | null;
  if (authError || !user?.id) {
    return deny('UNAUTHORIZED', 'Your session has expired. Please sign in again.', 401);
  }

  // Ownership lookup. `auth_user_id` is unique, so at most one row matches.
  const { data, error } = await svc
    .from('customers')
    .select('id, customer_number, email, status, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) return deny('INTERNAL', 'Could not resolve your account', 500);
  if (!data) {
    return deny(
      'FORBIDDEN',
      'This sign-in is not a customer account. Staff accounts use the administration console.',
      403,
    );
  }

  return {
    userId: user.id,
    customerId: String(data.id),
    customerNumber: String(data.customer_number),
    email: String(data.email),
    status: String(data.status) as CustomerStatus,
  };
}

/** True when the principal may use the portal. A suspended member may sign in
 *  and read their own profile, but not their membership or points. */
export const isActiveCustomer = (principal: CustomerPrincipal) => principal.status === 'active';

/** Narrow a union to the success branch. */
export function assertCustomer(
  resolved: CustomerPrincipal | CustomerDenial,
): asserts resolved is CustomerPrincipal {
  if ('error' in resolved) throw new Error('assertCustomer called with a denial');
}

export { deny as customerDenial };
