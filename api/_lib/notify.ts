/**
 * Member notifications (migration 20270105000028). IN-SYSTEM ONLY.
 *
 * `notifyCustomer` stores an in-app notice for one member; the member portal's
 * bell and notifications page show it. No email is sent (owner instruction
 * 2026-11-22: "do this inside the system so no more email is involved"). Staff
 * see new work through the admin header bell (`GET staff-alerts`), which counts
 * the work tables directly, so nothing is sent to staff either.
 *
 * A notice is a side effect of an action that has ALREADY committed (a booking
 * decision, a reply, a verified payment), so this never throws: a storage
 * problem must not undo or fail the staff action.
 */
import type { NotificationKind } from '@afhomes/contracts';

import type { Db } from './handler-kit.js';

export type MemberNotice = {
  kind: NotificationKind;
  title: string;
  body: string;
  /** A portal path such as `/customer/bookings`. */
  link: string | null;
};

export async function notifyCustomer(
  db: Db,
  customerId: string,
  notice: MemberNotice,
): Promise<void> {
  try {
    const inserted = await db.from('customer_notifications').insert({
      customer_id: customerId,
      kind: notice.kind,
      title: notice.title.slice(0, 150),
      body: notice.body.slice(0, 1000),
      link: notice.link,
    });
    if (inserted.error) console.warn('[afhomes:notify] a member notification could not be stored');
  } catch {
    console.warn('[afhomes:notify] a member notification could not be stored');
  }
}
