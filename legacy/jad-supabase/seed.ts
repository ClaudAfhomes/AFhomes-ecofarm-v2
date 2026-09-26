/**
 * Supabase Auth seed - Phase 1 fresh start (no Prisma)
 * Creates exactly two test accounts for login/role/protected-routing:
 *   admin@jad.local -> /admin (role: super_admin)
 *   user@jad.local  -> /user  (role: user)
 *
 * Passwords MUST come from environment (gitignored):
 *   SUPABASE_SEED_ADMIN_PASSWORD
 *   SUPABASE_SEED_USER_PASSWORD
 * Set in root .env (never commit, never VITE_). Example .env:
 *   SUPABASE_SEED_ADMIN_PASSWORD=your-admin-password
 *   SUPABASE_SEED_USER_PASSWORD=your-user-password
 *
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 * Run: pnpm seed  (tsx supabase/seed.ts) or pnpm --filter @jad/web exec tsx ../../supabase/seed.ts
 */

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

import { isAuthConflict } from '../api/_lib/auth.js';
import { STAFF_PERMISSIONS } from '../packages/contracts/src/schemas/staff-role.js';

function loadEnvFile(path: string) {
  try {
    const content = fs.readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env) && value) process.env[key] = value;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('apps/web/.env.local');
loadEnvFile('apps/admin/.env.local');

let supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SUPABASE_SEED_ADMIN_PASSWORD;
const userPassword = process.env.SUPABASE_SEED_USER_PASSWORD;

if ((!supabaseUrl || supabaseUrl.includes('your-project')) && process.env.DATABASE_URL) {
  try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    const host = dbUrl.hostname;
    const ref = host.split('.')[0].replace(/^db\./, '');
    if (ref && ref !== 'db') supabaseUrl = `https://${ref}.supabase.co`;
  } catch {}
}
if (supabaseUrl?.includes('your-project')) supabaseUrl = 'https://vudwoqduebdgtzvybywb.supabase.co';

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  console.error('Found:', {
    supabaseUrl: supabaseUrl ? 'set' : 'missing',
    serviceKey: serviceKey ? 'set' : 'missing',
  });
  process.exit(1);
}
if (!adminPassword || !userPassword) {
  console.error(
    'Missing SUPABASE_SEED_ADMIN_PASSWORD or SUPABASE_SEED_USER_PASSWORD in .env (never commit).',
  );
  console.error('Add to root .env (gitignored):');
  console.error('  SUPABASE_SEED_ADMIN_PASSWORD=<admin password>');
  console.error('  SUPABASE_SEED_USER_PASSWORD=<user password>');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false } });

async function seed() {
  console.log('Seeding Supabase Auth - admin/user (fresh start)...');

  const users = [
    { email: 'admin@jad.local', password: adminPassword!, role: 'admin', fullName: 'Admin' },
    { email: 'user@jad.local', password: userPassword!, role: 'user', fullName: 'User' },
  ];

  const createdIds: Record<string, string> = {};
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { role: u.role, full_name: u.fullName },
    });
    if (error && !isAuthConflict(error)) {
      console.error(`Failed to create ${u.email}:`, error.message);
      // try to update password if already exists - helps rotating seed passwords from env
      const { data: listed } = await supabase.auth.admin.listUsers();
      const found = listed.users.find((x) => x.email === u.email);
      if (found) {
        const { error: updErr } = await supabase.auth.admin.updateUserById(found.id, {
          password: u.password,
        });
        if (updErr) console.error(`  update password failed:`, updErr.message);
        else console.log(`  Updated password for existing ${u.email}`);
      }
    } else {
      console.log(`Auth user ready: ${u.email}`);
    }
    const { data: listed } = await supabase.auth.admin.listUsers();
    const found = listed.users.find((usr) => usr.email === u.email);
    if (found) createdIds[u.email] = found.id;
    else if ((data as { user?: { id: string } } | null)?.user?.id)
      createdIds[u.email] = (data as { user: { id: string } }).user.id;
  }

  if (!createdIds['admin@jad.local'] || !createdIds['user@jad.local']) {
    const { data: listed } = await supabase.auth.admin.listUsers();
    for (const u of listed.users)
      if (u.email && !(u.email in createdIds)) createdIds[u.email] = u.id;
  }
  const adminId = createdIds['admin@jad.local'];
  const userId = createdIds['user@jad.local'];
  if (!adminId || !userId) {
    console.error('Could not resolve admin/user IDs', createdIds);
    process.exit(1);
  }

  // Ensure roles exist (idempotent) - try lowercase plural first (existing DB), then quoted
  const tryUpsert = async (table: string, payload: unknown, conflict: string) => {
    const { error } = await supabase.from(table).upsert(payload as never, { onConflict: conflict });
    return error;
  };
  // Role permissions converge to the STAFF_PERMISSIONS matrix seed (single
  // source) so GET /admin/roles never drops them (roleRecordSchema requires
  // >=1 permission); member-domain rows keep the empty set by design.
  const roles = [
    { slug: 'admin', name: 'Admin', description: 'Admin dashboard - Phase 1', domain: 'staff' },
    { slug: 'user', name: 'User', description: 'User dashboard - Phase 1', domain: 'member' },
    {
      slug: 'super_admin',
      name: 'Super Admin',
      description: 'Platform super user - full governance (BUSINESS-RULES #3)',
      domain: 'staff',
    },
    {
      slug: 'finance',
      name: 'Finance',
      description: 'Payment verification scope (BUSINESS-RULES #3)',
      domain: 'staff',
    },
    {
      slug: 'merchant',
      name: 'Merchant',
      description: 'Voucher redemption scope (BUSINESS-RULES #3)',
      domain: 'staff',
    },
  ].map((r) => ({
    ...r,
    permissions: [...((STAFF_PERMISSIONS as Record<string, readonly string[]>)[r.slug] ?? [])],
    is_system: true,
  }));
  let roleFailed = false;
  for (const r of roles) {
    let err = await tryUpsert('Role', r, 'slug');
    if (err) err = await tryUpsert('roles', r, 'slug');
    if (err) err = await tryUpsert('role', r, 'slug');
    if (err) {
      console.error(`Role upsert ${r.slug} failed:`, err.message);
      roleFailed = true;
    } else console.log(`Role ready: ${r.slug}`);
  }
  // Fetch role ids - prefer quoted PascalCase first per migration
  let roleRows: { id: string; slug: string }[] | null = null;
  for (const tbl of ['Role', 'roles', 'role']) {
    const { data, error } = await supabase.from(tbl).select('id,slug');
    if (!error && data && (data as unknown[]).length > 0) {
      roleRows = data as typeof roleRows;
      break;
    }
  }
  const roleIdBySlug: Record<string, string> = {};
  for (const r of roleRows ?? []) roleIdBySlug[r.slug] = r.id;
  if (!roleIdBySlug['admin'] || !roleIdBySlug['user']) {
    console.warn(
      'Role table not reachable - DB may have no tables yet (fresh project). Roles will be resolved via user_metadata fallback until migration is applied. Continuing...',
    );
    // Do not exit - auth via user_metadata will still work for Phase 1
    (roleRows as unknown) = [];
  }

  // Seed members - Phase 5 staff separation: ONLY user@jad.local gets a
  // Member row. admin@jad.local is staff-only (StaffUser, created below) and
  // must never hold a Member row, referral code, or financial identity.
  // Target existing quoted "Member" first (auth foundation: id, email, name, status, "isQualified")
  const memberPayloadQuoted = (id: string, email: string, firstName: string, lastName: string) => ({
    id,
    email,
    name: `${firstName} ${lastName}`,
    status: 'APPROVED_ACTIVE',
    isQualified: true,
  });
  // Legacy payload for "members" fallback (19-col Prisma) - only if quoted fails and legacy table exists
  const memberPayloadLegacy = (id: string, email: string, firstName: string, lastName: string) => ({
    id,
    email,
    firstName,
    lastName,
    dateOfBirth: '1990-01-01',
    age: 30,
    gender: 'MALE',
    countryCode: 'PH',
    countryName: 'Philippines',
    phone: '+639000000002',
    referralCode: 'USER001',
    status: 'APPROVED_ACTIVE',
    isQualified: true,
    isEmailVerified: true,
    isIdVerified: true,
    adminApproved: true,
    qualificationMet: true,
    programId: 'prog-001',
    name: `${firstName} ${lastName}`,
  });
  const membersQuoted = [memberPayloadQuoted(userId, 'user@jad.local', 'Regular', 'User')];
  const membersLegacy = [memberPayloadLegacy(userId, 'user@jad.local', 'Regular', 'User')];
  let memberFailed = false;
  for (let i = 0; i < membersQuoted.length; i++) {
    const mQuoted = membersQuoted[i]!;
    const mLegacy = membersLegacy[i]!;
    // Prefer quoted "Member" - authoritative per migration
    let err = await tryUpsert('Member', mQuoted, 'id');
    if (err) {
      // Fallback to legacy lowercase tables only if quoted is missing (compat)
      err = await tryUpsert('members', mLegacy, 'id');
      if (err) err = await tryUpsert('member', mLegacy, 'id');
    }
    if (err) {
      console.error(`Member upsert ${mQuoted.email} failed:`, err.message);
      memberFailed = true;
    } else console.log(`Member ready: ${mQuoted.email}`);
  }

  // Assign roles - split by domain (Phase 5 staff separation).
  // admin@jad.local is staff-only: StaffUser row + StaffAssignment to the
  // super_admin role. user@jad.local stays a pure Member with the member-tier
  // `user` link. A stale `admin` MemberRole from earlier seeds is
  // intentionally left in place pre-retirement - resolvers prioritize
  // super_admin, and Phase 5 removes staffer Member rows entirely.
  let memberRoleFailed = false;
  const userRid = roleIdBySlug['user'];
  if (!userId || !userRid) {
    console.error('MemberRole user@jad.local->user failed: missing member or role id');
    memberRoleFailed = true;
  } else {
    const payloadQuoted = { memberId: userId, roleId: userRid };
    const payloadSnake = { member_id: userId, role_id: userRid };
    let err = await tryUpsert('MemberRole', payloadQuoted, '"memberId","roleId"');
    if (err) err = await tryUpsert('member_roles', payloadSnake, 'member_id,role_id');
    if (err) err = await tryUpsert('memberrole', payloadQuoted, 'memberId,roleId');
    if (err) {
      console.error('MemberRole user@jad.local->user failed:', err.message);
      memberRoleFailed = true;
    } else console.log('Role assigned: user@jad.local -> user');
  }
  const superRid = roleIdBySlug['super_admin'];
  if (!adminId || !superRid) {
    console.error('StaffAssignment admin@jad.local->super_admin failed: missing auth or role id');
    memberRoleFailed = true;
  } else {
    const { error: staffErr } = await supabase
      .from('StaffUser')
      .upsert(
        { id: adminId, email: 'admin@jad.local', name: 'Admin User', status: 'ACTIVE' },
        { onConflict: 'id' },
      );
    if (staffErr) {
      console.error('StaffUser admin@jad.local failed:', staffErr.message);
      memberRoleFailed = true;
    } else {
      console.log('Staff user ready: admin@jad.local');
      const { error: assignErr } = await supabase
        .from('StaffAssignment')
        .upsert({ staffUserId: adminId, roleId: superRid }, { onConflict: 'staffUserId,roleId' });
      if (assignErr) {
        console.error('StaffAssignment admin@jad.local->super_admin failed:', assignErr.message);
        memberRoleFailed = true;
      } else console.log('Role assigned: admin@jad.local -> super_admin (staff domain)');
    }
  }

  // Reference data - Phase B1 (programs, questions, config, policies).
  // Values mirror packages/contracts/src/seeds/reference.ts (parity specs lock both sides).
  let refFailed = false;
  try {
    const refMod = await import('../packages/contracts/src/seeds/reference');
    for (const p of refMod.PROGRAM_SEEDS) {
      const { error } = await supabase.from('Program').upsert(p, { onConflict: 'id' });
      if (error) {
        console.error(`Program seed ${p.id} failed:`, error.message);
        refFailed = true;
      } else console.log(`Program ready: ${p.id}`);
    }
    for (const group of refMod.PROGRAM_QUESTION_SEEDS) {
      for (const q of group.questions) {
        const { error } = await supabase
          .from('ProgramQuestion')
          .upsert(
            { id: q.id, programId: group.programId, questionText: q.questionText },
            { onConflict: 'id' },
          );
        if (error) {
          console.error(`ProgramQuestion seed ${q.id} failed:`, error.message);
          refFailed = true;
        }
      }
    }
    console.log('Program questions ready');
    for (const c of refMod.CONFIG_SEEDS) {
      const { error } = await supabase.from('SystemConfig').upsert(c, { onConflict: 'key' });
      if (error) {
        console.error(`Config seed ${c.key} failed:`, error.message);
        refFailed = true;
      } else console.log(`Config ready: ${c.key}`);
    }
    for (const p of refMod.POLICY_SEEDS) {
      const { error } = await supabase.from('Policy').upsert(
        {
          id: p.id,
          slug: p.slug,
          type: p.type,
          title: p.title,
          content: p.content,
          updated_at: p.updatedAt,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`Policy seed ${p.id} failed:`, error.message);
        refFailed = true;
      } else console.log(`Policy ready: ${p.id}`);
    }
  } catch (e) {
    console.error('Reference seed failed:', (e as Error).message);
    refFailed = true;
  }

  // Notifications + content library - Phase B2. Broadcasts carry member_id
  // NULL; content items mirror @jad/mock marketing content verbatim.
  let notifyFailed = false;
  try {
    const { MOCK_MARKETING_CONTENT } =
      await import('../packages/mock/src/marketing/marketing-content');
    const broadcasts = [
      {
        id: 'ntf-001',
        title: 'Welcome to JA&D',
        body: 'Your membership is now Active + Qualified. You can submit sales and refer new members.',
        created_at: '2026-08-18T09:00:00.000Z',
      },
      {
        id: 'ntf-002',
        title: 'New income-generating properties in the catalog',
        body: 'The Admin team has added new fixed-value units to the catalog.',
        created_at: '2026-08-16T10:00:00.000Z',
      },
      {
        id: 'ntf-004',
        title: 'New: Join the JA&D Community',
        body: 'New marketing material and community update - find it in Marketing Tools or check the community links.',
        created_at: '2026-08-15T10:00:00.000Z',
      },
    ];
    for (const n of broadcasts) {
      const { error } = await supabase
        .from('Notification')
        .upsert({ ...n, member_id: null, read_at: null }, { onConflict: 'id' });
      if (error) {
        console.error(`Notification seed ${n.id} failed:`, error.message);
        notifyFailed = true;
      } else console.log(`Notification ready: ${n.id}`);
    }
    for (const c of MOCK_MARKETING_CONTENT) {
      const { error } = await supabase.from('ContentItem').upsert(
        {
          id: c.id,
          title: c.title,
          description: c.description ?? null,
          kind: c.kind,
          download_url: c.downloadUrl ?? null,
          share: c.share ?? null,
          published: true,
          created_at: c.createdAt,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`ContentItem seed ${c.id} failed:`, error.message);
        notifyFailed = true;
      }
    }
    console.log('Content items ready');
  } catch (e) {
    console.error('Notification/content seed failed:', (e as Error).message);
    notifyFailed = true;
  }

  // Member pipeline - Phase B3 (registrations, members+auth, customers, sales).
  // Values mirror apps/admin/src/mock (parity specs lock both sides).
  // Member auth accounts share one staging password (never commit it).
  let pipelineFailed = false;
  const memberPassword = process.env.SUPABASE_SEED_MEMBER_PASSWORD;
  try {
    const adminMock = await import('../apps/admin/src/mock/data');
    const regStore = await import('../apps/admin/src/mock/registrationMockStore');

    for (const r of regStore.initialRegistrations) {
      const { error } = await supabase.from('Registration').upsert(
        {
          id: r.id,
          status: r.status,
          firstName: r.firstName,
          middleInitial: r.middleInitial ?? null,
          lastName: r.lastName,
          nameSuffix: r.nameSuffix ?? null,
          phone: r.phone,
          dateOfBirth: r.dateOfBirth,
          gender: r.gender,
          countryCode: r.countryCode,
          countryName: r.countryName,
          address: r.address,
          programId: r.programId,
          programCode: r.programCode,
          referralCode: r.referralCode ?? null,
          qualificationAnswers: r.qualificationAnswers,
          governmentId: r.governmentId ?? null,
          submittedAt: r.submittedAt,
          reviewedAt: (r as { reviewedAt?: string }).reviewedAt ?? null,
          // Mock reviewedBy is the legacy staff slug 'admin-001'; the column is
          // uuid, so resolve it to the seeded admin auth user id.
          reviewedBy: (r as { reviewedBy?: string }).reviewedBy === 'admin-001' ? adminId : null,
          rejectionNote: (r as { rejectionNote?: unknown }).rejectionNote ?? null,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`Registration seed ${r.id} failed:`, error.message);
        pipelineFailed = true;
      }
    }
    console.log('Registrations ready');

    if (!memberPassword) {
      console.warn(
        'SUPABASE_SEED_MEMBER_PASSWORD not set - skipping member/sale/customer seeding (registrations kept).',
      );
    } else {
      const memberIds: Record<string, string> = {};
      for (const m of adminMock.MOCK_MEMBERS) {
        const name = `${m.firstName} ${m.lastName}`;
        const { data, error } = await supabase.auth.admin.createUser({
          email: m.email,
          password: memberPassword,
          email_confirm: true,
          user_metadata: { full_name: name },
        });
        if (error && !isAuthConflict(error)) {
          console.error(`Auth user ${m.email} failed:`, error.message);
          pipelineFailed = true;
          continue;
        }
        let id = (data as { user?: { id: string } } | null)?.user?.id;
        if (!id) {
          const { data: listed } = await supabase.auth.admin.listUsers();
          id = listed.users.find((x) => x.email === m.email)?.id;
        }
        if (!id) {
          console.error(`Auth user ${m.email} unresolvable`);
          pipelineFailed = true;
          continue;
        }
        memberIds[m.id] = id;
        const { error: mErr } = await supabase.from('Member').upsert(
          {
            id,
            email: m.email,
            name,
            status: m.status,
            isQualified: m.isQualified,
            firstName: m.firstName,
            lastName: m.lastName,
            phone: m.phone,
            address: m.address,
            countryCode: m.countryCode,
            countryName: m.countryName,
            programId: m.program.id,
            referralCode: m.referralCode,
            accountStatus: 'ACTIVE',
          },
          { onConflict: 'id' },
        );
        if (mErr) {
          console.error(`Member seed ${m.id} failed:`, mErr.message);
          pipelineFailed = true;
        } else console.log(`Member ready: ${m.id} (${m.email})`);
      }
      const memberRoles: Record<string, string[]> = {
        'mem-001': ['member_basic', 'member_qualified'],
        'mem-005': ['member_basic', 'member_qualified'],
        'mem-007': ['member_basic', 'member_qualified'],
      };
      const { data: roleRows } = await supabase.from('Role').select('id,slug');
      const roleIdBySlug: Record<string, string> = {};
      for (const r of (roleRows as { id: string; slug: string }[] | null) ?? [])
        roleIdBySlug[r.slug] = r.id;
      for (const [mid, slugs] of Object.entries(memberRoles)) {
        const dbId = memberIds[mid];
        if (!dbId) continue;
        for (const slug of [...new Set(['member_basic', ...slugs])]) {
          const rid = roleIdBySlug[slug];
          if (!rid) continue;
          const { error } = await supabase
            .from('MemberRole')
            .upsert({ memberId: dbId, roleId: rid }, { onConflict: '"memberId","roleId"' });
          if (error) {
            console.error(`MemberRole seed ${mid}->${slug} failed:`, error.message);
            pipelineFailed = true;
          }
        }
      }
      const customers = [
        {
          id: 'cust-001',
          memberId: memberIds['mem-001'],
          name: 'Ramon Reyes',
          phone: '+63 918 555 0101',
          email: 'ramon.reyes@example.com',
        },
        {
          id: 'cust-002',
          memberId: memberIds['mem-001'],
          name: 'Celine Cruz',
          phone: '+63 918 555 0202',
          email: null as string | null,
        },
      ];
      for (const c of customers) {
        if (!c.memberId) {
          console.error(`Customer seed ${c.id} skipped: seller unresolvable`);
          pipelineFailed = true;
          continue;
        }
        const { error } = await supabase.from('Customer').upsert(c, { onConflict: 'id' });
        if (error) {
          console.error(`Customer seed ${c.id} failed:`, error.message);
          pipelineFailed = true;
        } else console.log(`Customer ready: ${c.id}`);
      }
      for (const s of adminMock.MOCK_SALES) {
        const sellerId = memberIds[s.sellerId];
        if (!sellerId) {
          console.error(`Sale seed ${s.id} skipped: seller unresolvable`);
          pipelineFailed = true;
          continue;
        }
        const { error } = await supabase.from('Sale').upsert(
          {
            id: s.id,
            status: s.status,
            propertyId: s.propertyId,
            propertyName: s.propertyName,
            propertyValue: s.propertyValue,
            customerId: s.customerId,
            customerName: s.customerName,
            sellerId,
            sellerName: s.sellerName,
            submittedAt: s.submittedAt,
            approvedAt: (s as { approvedAt?: string }).approvedAt ?? null,
            paymentVerifiedAt: (s as { paymentVerifiedAt?: string }).paymentVerifiedAt ?? null,
            lockedAt: (s as { lockedAt?: string }).lockedAt ?? null,
            resubmissionCount: s.resubmissionCount,
            rejectionReason: (s as { rejectionReason?: string }).rejectionReason ?? null,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Sale seed ${s.id} failed:`, error.message);
          pipelineFailed = true;
        }
      }
      console.log('Sales ready');

      // Staff roster - Phase B4. Same staging password; DISABLED maps to
      // accountStatus INACTIVE. Operational provisioning path: real staff are
      // added the same way (auth user + Member row + staff role link).
      for (const s of adminMock.MOCK_STAFF) {
        const { data, error } = await supabase.auth.admin.createUser({
          email: s.email,
          password: memberPassword,
          email_confirm: true,
          user_metadata: { full_name: s.name },
        });
        if (error && !isAuthConflict(error)) {
          console.error(`Auth user ${s.email} failed:`, error.message);
          pipelineFailed = true;
          continue;
        }
        let id = (data as { user?: { id: string } } | null)?.user?.id;
        if (!id) {
          const { data: listed } = await supabase.auth.admin.listUsers();
          id = listed.users.find((x) => x.email === s.email)?.id;
        }
        if (!id) {
          console.error(`Auth user ${s.email} unresolvable`);
          pipelineFailed = true;
          continue;
        }
        const [firstName, ...rest] = s.name.split(' ');
        const { error: mErr } = await supabase.from('Member').upsert(
          {
            id,
            email: s.email,
            name: s.name,
            status: 'APPROVED_ACTIVE',
            isQualified: false,
            firstName,
            lastName: rest.join(' ') || firstName,
            accountStatus: s.status,
          },
          { onConflict: 'id' },
        );
        if (mErr) {
          console.error(`Staff member seed ${s.id} failed:`, mErr.message);
          pipelineFailed = true;
          continue;
        }
        const rid = roleIdBySlug[s.roleId];
        if (!rid) {
          console.error(`Staff role seed ${s.id} failed: unknown slug ${s.roleId}`);
          pipelineFailed = true;
          continue;
        }
        const { error: linkErr } = await supabase
          .from('MemberRole')
          .upsert({ memberId: id, roleId: rid }, { onConflict: '"memberId","roleId"' });
        if (linkErr) {
          console.error(`Staff role seed ${s.id}->${s.roleId} failed:`, linkErr.message);
          pipelineFailed = true;
        } else console.log(`Staff ready: ${s.id} (${s.email} -> ${s.roleId})`);
      }
    }
  } catch (e) {
    console.error('Pipeline seed failed:', (e as Error).message);
    pipelineFailed = true;
  }

  // B5 money lists - Phase B5 (transactional catalog side, payout accounts,
  // voucher templates + assignments, staff adjustments).
  // Values mirror apps/admin/src/mock (parity: same source records).
  let b5Failed = false;
  try {
    const b5Mock = await import('../apps/admin/src/mock/data');
    const b5Cms = await import('../packages/contracts/src/seeds/cms');
    for (const c of b5Cms.CMS_PROPERTIES_SEED.categories) {
      const { error } = await supabase
        .from('PropertyCategory')
        .upsert({ slug: c.slug, title: c.title }, { onConflict: 'slug' });
      if (error) {
        console.error(`PropertyCategory seed ${c.slug} failed:`, error.message);
        b5Failed = true;
      }
    }
    for (const p of b5Mock.MOCK_PROPERTIES) {
      const { error } = await supabase.from('Property').upsert(
        {
          id: p.id,
          name: p.name,
          categorySlug: p.categoryId,
          price: p.price ?? null,
          status: p.status,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`Property seed ${p.id} failed:`, error.message);
        b5Failed = true;
      }
    }
    console.log('Properties ready');
    for (const p of b5Mock.MOCK_PAYOUT_ACCOUNTS) {
      const { error } = await supabase.from('PayoutAccount').upsert(
        {
          id: p.id,
          method: p.method,
          accountName: p.accountName,
          // Legacy admin-queue seeds carry no owner or raw identifier.
          memberId: null,
          accountIdentifier: null,
          accountIdentifierMasked: p.accountIdentifierMasked,
          status: p.status,
          isPrimary: p.isPrimary,
          createdAt: p.createdAt,
          rejectionReason: p.rejectionReason ?? null,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`PayoutAccount seed ${p.id} failed:`, error.message);
        b5Failed = true;
      }
    }
    console.log('Payouts ready');
    for (const t of b5Mock.MOCK_VOUCHERS) {
      const { error } = await supabase.from('VoucherTemplate').upsert(
        {
          id: t.id,
          title: t.title,
          originalValue: t.originalValue,
          createdAt: t.createdAt,
          expiresAt: t.expiresAt ?? null,
          validityDays: t.validityDays ?? null,
        },
        { onConflict: 'id' },
      );
      if (error) {
        console.error(`VoucherTemplate seed ${t.id} failed:`, error.message);
        b5Failed = true;
      }
    }
    console.log('Voucher templates ready');

    // Member-linked rows resolve mem-xxx to Member uuid via email (same as
    // the B3 pipeline seed). Without seeded members these are skipped.
    const { data: b5MemberRows } = await supabase.from('Member').select('id,email');
    const b5UuidByMemId: Record<string, string> = {};
    for (const m of b5Mock.MOCK_MEMBERS) {
      const hit = ((b5MemberRows as { id: string; email: string }[] | null) ?? []).find(
        (r) => r.email === m.email,
      );
      if (hit) b5UuidByMemId[m.id] = hit.id;
    }
    const b5Linked: { memberId: string }[] = [
      ...b5Mock.MOCK_VOUCHER_ASSIGNMENTS,
      ...b5Mock.MOCK_ADJUSTMENTS,
    ];
    const b5Unresolved = [...new Set(b5Linked.map((r) => r.memberId))].filter(
      (id) => !b5UuidByMemId[id],
    );
    if (b5Unresolved.length > 0) {
      console.warn(
        `SUPABASE_SEED_MEMBER_PASSWORD seeding incomplete - skipping vouchers/adjustments (members unresolvable: ${b5Unresolved.join(', ')}).`,
      );
    } else {
      for (const v of b5Mock.MOCK_VOUCHER_ASSIGNMENTS) {
        const { error } = await supabase.from('Voucher').upsert(
          {
            id: v.id,
            templateId: v.templateId,
            code: v.code,
            title: v.title,
            originalValue: v.originalValue,
            remainingValue: v.remainingValue,
            status: v.status,
            memberId: b5UuidByMemId[v.memberId],
            memberName: v.memberName,
            createdAt: v.createdAt,
            expiresAt: (v as { expiresAt?: string }).expiresAt ?? null,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Voucher seed ${v.id} failed:`, error.message);
          b5Failed = true;
        }
      }
      console.log('Vouchers ready');
      for (const a of b5Mock.MOCK_ADJUSTMENTS) {
        const { error } = await supabase.from('Adjustment').upsert(
          {
            id: a.id,
            memberId: b5UuidByMemId[a.memberId],
            memberName: a.memberName,
            entryType: a.entryType,
            direction: a.direction,
            amount: a.amount,
            reason: a.reason,
            createdBy: a.createdBy,
            createdAt: a.createdAt,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Adjustment seed ${a.id} failed:`, error.message);
          b5Failed = true;
        }
      }
      console.log('Adjustments ready');
    }
  } catch (e) {
    console.error('B5 seed failed:', (e as Error).message);
    b5Failed = true;
  }

  // B6 money core - Phase B6 (stored wallets, ledger, member payout
  // accounts, withdrawals, commissions). Values mirror
  // apps/web/src/mock/store.ts (member universe) plus the admin-queue-only
  // withdrawals wdr-004..006 from apps/admin/src/mock/data.ts.
  let b6Failed = false;
  try {
    const webStore = await import('../apps/web/src/mock/store');
    const adminMockB6 = await import('../apps/admin/src/mock/data');
    const store = webStore.createMockStore();
    const { data: b6MemberRows } = await supabase.from('Member').select('id,email');
    const b6UuidByEmail: Record<string, string> = {};
    for (const r of (b6MemberRows as { id: string; email: string }[] | null) ?? []) {
      b6UuidByEmail[r.email] = r.id;
    }
    const mem001 = b6UuidByEmail['juan.delacruz@example.com'];
    if (!mem001) {
      console.warn(
        'Seeded member juan.delacruz@example.com not found - skipping wallets/ledger/payouts/withdrawals/commissions (set SUPABASE_SEED_MEMBER_PASSWORD and re-run).',
      );
    } else {
      const walletSeeds: Record<string, { a: string; p: string; w: string; e: string }> = {
        [mem001]: { a: '776000.00', p: '0.00', w: '125000.00', e: '876000.00' },
      };
      for (const [memberId, b] of Object.entries(walletSeeds)) {
        const { error } = await supabase.from('Wallet').upsert(
          {
            memberId,
            availableBalance: b.a,
            pendingAmount: b.p,
            totalWithdrawals: b.w,
            totalEarned: b.e,
          },
          { onConflict: 'memberId' },
        );
        if (error) {
          console.error(`Wallet seed ${memberId} failed:`, error.message);
          b6Failed = true;
        }
      }
      console.log('Wallets ready');
      for (const e of store.ledger) {
        const { error } = await supabase.from('LedgerEntry').upsert(
          {
            id: e.id,
            memberId: mem001,
            entryType: e.entryType,
            direction: e.direction,
            amount: e.amount,
            createdAt: e.createdAt,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`LedgerEntry seed ${e.id} failed:`, error.message);
          b6Failed = true;
        }
      }
      console.log('Ledger ready');
      for (const c of store.commissions) {
        const { error } = await supabase.from('Commission').upsert(
          {
            id: c.id,
            memberId: mem001,
            commissionType: c.commissionType,
            saleId: c.saleId,
            baseValue: c.baseValue,
            rate: c.rate,
            amount: c.amount,
            status: c.status,
            clearedAt: c.clearedAt ?? null,
            cancelledAt: c.cancelledAt ?? null,
            reversedAt: c.reversedAt ?? null,
            createdAt: c.createdAt,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Commission seed ${c.id} failed:`, error.message);
          b6Failed = true;
        }
      }
      console.log('Commissions ready');
      for (const a of store.payoutAccounts) {
        const { error } = await supabase.from('PayoutAccount').upsert(
          {
            id: a.id,
            memberId: mem001,
            method: a.method,
            accountName: a.accountName,
            accountIdentifier: a.accountIdentifier,
            accountIdentifierMasked: webStore.maskIdentifier(a.accountIdentifier),
            status: a.status,
            isPrimary: a.isPrimary,
            createdAt: a.createdAt,
            rejectionReason: a.rejectionReason ?? null,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`PayoutAccount seed ${a.id} failed:`, error.message);
          b6Failed = true;
        }
      }
      console.log('Member payout accounts ready');
      const paById: Record<
        string,
        { method: string; accountName: string; accountIdentifier: string }
      > = {};
      for (const a of store.payoutAccounts) paById[a.id] = a;
      for (const w of store.withdrawals) {
        const snap = paById[w.payoutAccountId];
        const { error } = await supabase.from('Withdrawal').upsert(
          {
            id: w.id,
            memberId: mem001,
            payoutAccountId: w.payoutAccountId,
            accountMethod: snap?.method ?? 'OTHER',
            accountName: snap?.accountName ?? 'Payout account',
            accountIdentifierMasked: webStore.maskIdentifier(snap?.accountIdentifier ?? ''),
            amount: w.amount,
            status: w.status,
            reservedAt: w.reservedAt ?? null,
            completedAt: w.completedAt ?? null,
            rejectedAt: w.rejectedAt ?? null,
            rejectionReason: w.rejectionReason ?? null,
            externalReference: w.externalReference ?? null,
            createdAt: w.createdAt,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Withdrawal seed ${w.id} failed:`, error.message);
          b6Failed = true;
        }
      }
      // Admin-queue-only rows (no member linkage) mirror the admin mock.
      for (const w of adminMockB6.MOCK_WITHDRAWALS.filter((r) =>
        ['wdr-004', 'wdr-005', 'wdr-006'].includes(r.id),
      )) {
        const { error } = await supabase.from('Withdrawal').upsert(
          {
            id: w.id,
            memberId: null,
            payoutAccountId: w.payoutAccount.id,
            accountMethod: w.payoutAccount.method,
            accountName: w.payoutAccount.accountName,
            accountIdentifierMasked: w.payoutAccount.accountIdentifierMasked,
            amount: w.amount,
            status: w.status,
            reservedAt: w.reservedAt ?? null,
            completedAt: w.completedAt ?? null,
            rejectedAt: w.rejectedAt ?? null,
            rejectionReason: w.rejectionReason ?? null,
            externalReference: null,
            createdAt: w.createdAt,
          },
          { onConflict: 'id' },
        );
        if (error) {
          console.error(`Withdrawal seed ${w.id} failed:`, error.message);
          b6Failed = true;
        }
      }
      console.log('Withdrawals ready');
    }
  } catch (e) {
    console.error('B6 seed failed:', (e as Error).message);
    b6Failed = true;
  }

  // B7 referrals - Phase B7 (member sponsor linkage mirrors the web mock).
  let b7Failed = false;
  try {
    const webStoreB7 = await import('../apps/web/src/mock/store');
    const refStore = webStoreB7.createMockStore();
    const { data: b7MemberRows } = await supabase.from('Member').select('id,email');
    const b7UuidByEmail: Record<string, string> = {};
    for (const r of (b7MemberRows as { id: string; email: string }[] | null) ?? []) {
      b7UuidByEmail[r.email] = r.id;
    }
    const emailByMemId: Record<string, string> = {};
    for (const m of refStore.members) emailByMemId[m.id] = m.email;
    let linked = 0;
    for (const m of refStore.members) {
      if (!m.sponsorId) continue;
      const memberId = b7UuidByEmail[m.email];
      const sponsorId = b7UuidByEmail[emailByMemId[m.sponsorId] ?? ''];
      if (!memberId || !sponsorId) {
        console.warn(`Sponsor seed skipped for ${m.id}: member or sponsor unresolvable.`);
        continue;
      }
      const { error } = await supabase.from('Member').update({ sponsorId }).eq('id', memberId);
      if (error) {
        console.error(`Sponsor seed ${m.id} failed:`, error.message);
        b7Failed = true;
      } else linked += 1;
    }
    console.log(`Sponsors ready (${linked} linked)`);
  } catch (e) {
    console.error('B7 seed failed:', (e as Error).message);
    b7Failed = true;
  }

  // Commission backfill - PENDING commissions for QUALIFYING_SALE rows that
  // have none (mirrors the sale_qualify function: PG round half-away on
  // SystemConfig rates; referral payee is the picked referrer, else the
  // seller's sponsor, else skipped). Idempotent: sales that already have
  // commissions are skipped, so re-runs (and the live qualify path) never
  // duplicate.
  let commissionBackfillFailed = false;
  try {
    const toCents = (value: string): bigint => {
      const [whole = '0', frac = ''] = value.split('.');
      return BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
    };
    const fromCents = (cents: bigint): string => {
      const whole = cents / 100n;
      const frac = cents % 100n;
      return `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
    };
    const toBp = (rate: string): bigint => {
      const [whole = '0', frac = ''] = rate.split('.');
      return BigInt(whole) * 10000n + BigInt((frac + '0000').slice(0, 4));
    };
    const { data: rateRows } = await supabase
      .from('SystemConfig')
      .select('key,value')
      .in('key', ['COMMISSION_DIRECT_RATE', 'COMMISSION_REFERRAL_RATE']);
    const rateByKey: Record<string, string> = {};
    for (const r of (rateRows as { key: string; value: string }[] | null) ?? []) {
      rateByKey[r.key] = r.value;
    }
    const directRate = rateByKey.COMMISSION_DIRECT_RATE ?? '';
    const referralRate = rateByKey.COMMISSION_REFERRAL_RATE ?? '';
    const rateOk = (r: string) => /^\d+(\.\d{1,4})?$/.test(r);
    if (!rateOk(directRate) || !rateOk(referralRate)) {
      console.warn('Commission backfill skipped: commission rates misconfigured.');
    } else {
      const { data: qualifiedSales } = await supabase
        .from('Sale')
        .select('id,propertyValue,sellerId,referrerId')
        .eq('status', 'QUALIFYING_SALE');
      let created = 0;
      for (const s of (qualifiedSales as
        | {
            id: string;
            propertyValue: string;
            sellerId: string | null;
            referrerId: string | null;
          }[]
        | null) ?? []) {
        if (!s.sellerId || !/^\d+(\.\d{1,2})?$/.test(s.propertyValue)) continue;
        const { count } = await supabase
          .from('Commission')
          .select('id', { count: 'exact', head: true })
          .eq('saleId', s.id);
        if ((count ?? 0) > 0) continue;
        const base = toCents(s.propertyValue);
        const direct = fromCents((base * toBp(directRate) + 5000n) / 10000n);
        const now = new Date().toISOString();
        const rows: Record<string, unknown>[] = [
          {
            // Deterministic ids: re-runs converge instead of duplicating.
            id: `com-${s.id}-direct`,
            memberId: s.sellerId,
            commissionType: 'DIRECT_COMMISSION',
            saleId: s.id,
            baseValue: s.propertyValue,
            rate: directRate,
            amount: direct,
            status: 'PENDING',
            createdAt: now,
          },
        ];
        const { data: seller } = await supabase
          .from('Member')
          .select('sponsorId')
          .eq('id', s.sellerId)
          .maybeSingle();
        const sponsorId = (seller as { sponsorId?: string | null } | null)?.sponsorId ?? null;
        // Referrer wins; otherwise the seller's sponsor; never the seller.
        const payeeId =
          s.referrerId && s.referrerId !== s.sellerId
            ? s.referrerId
            : sponsorId && sponsorId !== s.sellerId
              ? sponsorId
              : null;
        if (payeeId) {
          const referral = fromCents((base * toBp(referralRate) + 5000n) / 10000n);
          rows.push({
            id: `com-${s.id}-referral`,
            memberId: payeeId,
            commissionType: 'DIRECT_REFERRAL',
            saleId: s.id,
            baseValue: s.propertyValue,
            rate: referralRate,
            amount: referral,
            status: 'PENDING',
            createdAt: now,
          });
        }
        const { error } = await supabase.from('Commission').upsert(rows, { onConflict: 'id' });
        if (error) {
          console.error(`Commission backfill ${s.id} failed:`, error.message);
          commissionBackfillFailed = true;
        } else {
          created += rows.length;
        }
      }
      console.log(`Commission backfill ready (${created} created)`);
    }
  } catch (e) {
    console.error('Commission backfill failed:', (e as Error).message);
    commissionBackfillFailed = true;
  }

  // CMS contents - Q2 single table (key, content JSONB, version) + Q5 updatedAt/By only
  // Seed-safe shared source per requirements - no browser deps
  let cmsSeeds: { key: string; content: unknown }[] = [];
  let cmsImportFailed = false;
  try {
    const cmsMod = await import('../packages/contracts/src/seeds/cms');
    cmsSeeds = [
      { key: 'homepage', content: cmsMod.CMS_HOMEPAGE_SEED },
      { key: 'about', content: cmsMod.CMS_ABOUT_SEED },
      { key: 'properties', content: cmsMod.CMS_PROPERTIES_SEED },
      { key: 'faqs', content: cmsMod.CMS_FAQS_SEED },
      { key: 'contact', content: cmsMod.CMS_CONTACT_SEED },
      { key: 'global', content: cmsMod.CMS_GLOBAL_SEED },
      { key: 'login', content: cmsMod.CMS_LOGIN_SEED },
      { key: 'register', content: cmsMod.CMS_REGISTER_SEED },
    ];
  } catch (e) {
    console.error('CMS seed import failed:', (e as Error).message);
    cmsImportFailed = true;
  }
  let cmsFailed = false;
  if (cmsImportFailed) {
    console.error('CMS seed aborted: failed to import CMS seeds');
    cmsFailed = true;
  } else {
    try {
      for (const { key, content } of cmsSeeds) {
        const { error } = await supabase
          .from('cms_contents')
          .upsert({ key, content, version: 1, updated_by: adminId }, { onConflict: 'key' });
        if (error) {
          console.error(`CMS seed ${key} failed:`, error.message);
          cmsFailed = true;
        } else {
          console.log(`CMS ready: ${key}`);
        }
      }
    } catch (e) {
      console.error('CMS seed failed:', (e as Error).message);
      cmsFailed = true;
    }
  }

  if (
    roleFailed ||
    memberFailed ||
    memberRoleFailed ||
    refFailed ||
    notifyFailed ||
    pipelineFailed ||
    b5Failed ||
    b6Failed ||
    b7Failed ||
    commissionBackfillFailed ||
    cmsFailed
  ) {
    console.error('Seed completed with errors.');
    process.exit(1);
  }
  console.log('Seed complete.');
  console.log(
    'Next: refresh http://localhost:5173/login → admin@jad.local / $SUPABASE_SEED_ADMIN_PASSWORD → /admin',
  );
  console.log('      or user@jad.local / $SUPABASE_SEED_USER_PASSWORD → /user');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
