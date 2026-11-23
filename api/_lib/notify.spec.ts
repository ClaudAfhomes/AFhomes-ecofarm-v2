/**
 * notify.ts: member notices are stored in-app only. Nothing is emailed, and a
 * storage failure never throws into the (already committed) staff action.
 */
import { describe, expect, it, vi } from 'vitest';

import * as notify from './notify.js';
import { FakeSupabase } from './testing/supabase-fake.js';

describe('notifyCustomer', () => {
  it('stores the notice for the member and sends no email', async () => {
    const fake = new FakeSupabase({
      tables: { customers: [{ id: 'c1', email: 'member@example.invalid' }], customer_notifications: [] },
      defaults: { customer_notifications: { email_status: 'not_requested', read_at: null } },
    });
    await notify.notifyCustomer(fake, 'c1', {
      kind: 'booking',
      title: 'Booking confirmed',
      body: 'See you.',
      link: '/customer/bookings',
    });
    expect(fake.tables.customer_notifications).toHaveLength(1);
    expect(fake.tables.customer_notifications![0]).toMatchObject({
      customer_id: 'c1',
      kind: 'booking',
      link: '/customer/bookings',
      email_status: 'not_requested',
      read_at: null,
    });
    // The member's address is never even read.
    expect(fake.calls.some((c) => c.table === 'customers')).toBe(false);
  });

  it('exposes no email or staff-alert sender', () => {
    expect(Object.keys(notify).sort()).toEqual(['notifyCustomer']);
  });

  it('never throws when storage fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    };
    await expect(
      notify.notifyCustomer(broken, 'c1', { kind: 'account', title: 't', body: '', link: null }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('db down');
    warn.mockRestore();
  });
});
