import type { Db } from 'mongodb';
import { afHomesDashboardSchema } from '@afhomes/contracts';
import { projectDashboard, type DashboardInput } from './dashboard-projection.js';

/** Same source projections and calculation; no counters stand in for business records. */
export async function mongoDashboard(db: Db, range: string) {
  const [sales, payments, memberships, qualifications, commissions, ost, ostApplications, staff] = await Promise.all([
    db.collection<DashboardInput['sales'][number]>('card_sales').find({}, { projection: { status: 1, created_at: 1 } }).toArray(),
    db.collection<DashboardInput['payments'][number]>('payments').find({}, { projection: { status: 1, amount: 1, verified_at: 1 } }).toArray(),
    db.collection<DashboardInput['memberships'][number]>('memberships').find({}, { projection: { status: 1, points_balance: 1, activated_at: 1 } }).toArray(),
    db.collection<DashboardInput['qualifications'][number]>('final_qualifications').find({}, { projection: { status: 1 } }).toArray(),
    db.collection<DashboardInput['commissions'][number]>('commissions').find({}, { projection: { status: 1, amount: 1 } }).toArray(),
    db.collection<DashboardInput['ost'][number]>('ost_members').find({}, { projection: { status: 1 } }).toArray(),
    db.collection<DashboardInput['ostApplications'][number]>('ost_applications').find({}, { projection: { status: 1 } }).toArray(),
    db.collection<DashboardInput['staff'][number]>('staff_users').find({}, { projection: { status: 1 } }).toArray(),
  ]);
  return afHomesDashboardSchema.parse(projectDashboard({ sales, payments, memberships, qualifications, commissions, ost, ostApplications, staff }, range));
}
