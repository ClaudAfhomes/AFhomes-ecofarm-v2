import { describe, expect, it } from 'vitest';
import { validateOstSponsor } from './ost-sponsor.js';
import { FakeSupabase } from './testing/supabase-fake.js';
import { serviceClient } from './rest.js';

describe('OST sponsor contexts', () => {
  it.each(['vice_director', 'senior_sales_manager', 'sales_manager'])(
    'accepts an active %s for public referrals',
    async (slug) => {
      const db = new FakeSupabase({ tables: {
        staff_users: [{ id: 'sponsor', full_name: 'SYNTHETIC SPONSOR', email: 'qa@example.invalid', status: 'active' }],
        staff_role_assignments: [{ staff_id: 'sponsor', role_id: 'role' }],
        roles: [{ id: 'role', slug, is_active: true }],
      } });
      expect((await validateOstSponsor(db as unknown as NonNullable<ReturnType<typeof serviceClient>>, 'sponsor')).ok).toBe(true);
    },
  );
  it.each(['admin', 'ost', 'employee'])(
    'rejects %s as a public sponsor',
    async (slug) => {
      const db = new FakeSupabase({ tables: {
        staff_users: [{ id: 'sponsor', full_name: 'SYNTHETIC', status: 'active' }],
        staff_role_assignments: [{ staff_id: 'sponsor', role_id: 'role' }],
        roles: [{ id: 'role', slug, is_active: true }],
      } });
      expect((await validateOstSponsor(db as unknown as NonNullable<ReturnType<typeof serviceClient>>, 'sponsor')).ok).toBe(false);
    },
  );
});
