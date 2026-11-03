import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db, MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { getRequest, setResponse } from 'better-call/node';
import {
  changeAfHomesStaffPasswordSchema,
  updateAfHomesStaffProfileSchema,
  authPortalsSchema,
  PROFILE_PHOTO_MAX_BYTES,
} from '@afhomes/contracts';
import { createAfHomesAuth, getAuthOptions, type AuthDelivery } from './auth.js';
import { createAuthNodeHandler } from './auth-transport.js';
import { createMongoSessionVerifier, requestHeaders } from './auth-verify.mongo.js';
import { createMongoStaffAccess } from './afhomes-access.mongo.js';
import { createMongoCatalogHandlers, setupMongoCatalog } from './catalog.mongo.js';
import { createMongoCustomersHandler, setupMongoCustomers } from './customers.mongo.js';
import { createMongoCustomerHandlers } from './customer-handlers.mongo.js';
import { setupCustomerActivation, type MongoRow } from './customer-activation.mongo.js';
import { setupMongoCustomerPoints } from './customer-points.mongo.js';
import { createMongoOrganizationHandler, setupMongoOrganization } from './organization.mongo.js';
import { createMongoImportClaimsHandlers } from './import-claims.mongo.js';
import { createMongoImportContinuationHandlers } from './import-continuation.mongo.js';
import { createMongoCustomerImportJobsHandler, setupMongoImportJobs } from './customer-import-jobs.mongo.js';
import { MAX_IMPORT_BYTES } from './customer-import.js';
import { setupMongoImportClaims } from './import-claim-records.mongo.js';
import { setupMongoHistoricalImports } from './historical-import.mongo.js';
import { createMongoAnalyticsHandler } from './analytics.mongo.js';
import { mongoDashboard } from './dashboard.mongo.js';
import { createMongoDocumentHandlers } from './documents.mongo.js';
import { createMongoSalesHandler, setupMongoSales } from './sales.mongo.js';
import { createMongoCommissionsHandler } from './commissions.mongo.js';
import { createMongoQueuesHandler } from './queues.mongo.js';
import { createMongoMembershipsHandler } from './memberships.mongo.js';
import { createMongoReferralsHandler, setupMongoReferrals } from './referrals.mongo.js';
import { createMongoGenealogyHandler } from './genealogy.mongo.js';
import { createMongoIstPortalHandler } from './ist-portal.mongo.js';
import { createMongoSaleTeamHandler, setupMongoSaleTeam } from './sale-team.mongo.js';
import { setupMongoPublicSearch } from './sale-team-search.mongo.js';
import { createMongoMembersHandler, setupMongoMembers } from './members.mongo.js';
import { createMongoPointsAdjustment } from './points-adjustment.mongo.js';
import { createMongoStaffSalesInvolvementHandler } from './staff-sales-involvement.mongo.js';
import { createMongoPublicVerificationSettingsHandler } from './public-verification-settings.mongo.js';
import {
  createMongoOstAccreditationHandler,
  setupMongoOstAccreditation,
} from './ost-accreditation.mongo.js';
import { createMongoOstHandler } from './ost.mongo.js';
import { createMongoProfilePhotoHandler, setupMongoProfilePhotos } from './profile-photo.mongo.js';
import { createS3PrivateObjectStore, type PrivateObjectStore } from './private-object-store.js';
import { createAddressHandler } from '../_handlers/_address.js';
import { createMongoOfficialFormsHandler, setupMongoOfficialForms } from './official-forms.mongo.js';
import {
  createLocalPublicMediaStore,
  type PublicMediaStore,
} from './public-media-store.js';
import { createMongoMediaHandlers } from './media.mongo.js';
import { FEATURE_FLAGS, isFeaturePathEnabled } from '@afhomes/shared';
import { deny, fail } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

/** Explicit operator setup; never called by import, health, ping or app requests. */
export async function setupMongoPhase5(db: Db) {
  await setupCustomerActivation(db);
  await setupMongoCatalog(db);
  await setupMongoCustomers(db);
  await setupMongoCustomerPoints(db);
  await setupMongoOrganization(db);
  await setupMongoSales(db);
  await setupMongoReferrals(db);
  await setupMongoSaleTeam(db);
  await setupMongoPublicSearch(db);
  await setupMongoMembers(db);
  await setupMongoOstAccreditation(db);
  await setupMongoProfilePhotos(db);
  await setupMongoOfficialForms(db);
  await setupMongoImportClaims(db);
  await setupMongoImportJobs(db);
  await setupMongoHistoricalImports(db);
}

/** Converted routes only. Injected database; there is no Supabase or remote fallback. */
export function createMongoPhase5Runtime(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv,
  delivery: AuthDelivery = {},
  objectStore?: PrivateObjectStore | null,
  runtimeOptions: {
    clientIp?: (req: IncomingMessage) => string;
    mediaStore?: PublicMediaStore | null;
  } = {},
) {
  const auth = createAfHomesAuth(db, client, env, delivery),
    options = getAuthOptions(env);
  const objects = objectStore === null ? undefined : objectStore ?? createS3PrivateObjectStore(env);
  const mediaStore =
    runtimeOptions.mediaStore === null
      ? undefined
      : runtimeOptions.mediaStore ?? createLocalPublicMediaStore(env);
  const sessions = createMongoSessionVerifier(db, auth),
    access = createMongoStaffAccess(db, sessions, env);
  const catalog = createMongoCatalogHandlers(db, client, access.authorize);
  const customers = createMongoCustomersHandler(db, client, access.authorize);
  const documents = createMongoDocumentHandlers(db,client,access.authorize,env,objects);
  const organization = createMongoOrganizationHandler(db, client, access.authorize);
  const sales = createMongoSalesHandler(db, client, access.authorize, env);
  const commissions = createMongoCommissionsHandler(db, client, access.authorize);
  const queues = createMongoQueuesHandler(db, access.authorize);
  const memberships = createMongoMembershipsHandler(db, client, access.authorize, objects);
  const referrals = createMongoReferralsHandler(db, client, access.authorize);
  const importClaims = createMongoImportClaimsHandlers(db, client, access.authorize, env, objects);
  const importContinuation = createMongoImportContinuationHandlers(db, client, access.authorize);
  const importJobs = createMongoCustomerImportJobsHandler(db, client, access.authorize, importContinuation);
  const analytics = createMongoAnalyticsHandler(db, access.authorize);
  const genealogy = createMongoGenealogyHandler(db, access.authorize);
  const istPortal = createMongoIstPortalHandler(db, access.authorize);
  const saleTeam = createMongoSaleTeamHandler(db, client, access.resolve, access.authorize, objects, env);
  const ostAccreditation = createMongoOstAccreditationHandler(
    db,
    client,
    access.resolve,
    access.authorize,
  );
  const ost = createMongoOstHandler(db, access.resolve);
  const members = createMongoMembersHandler(db, client, access.authorize, objects);
  const pointsAdjustment = createMongoPointsAdjustment(db,client,access.authorize);
  const ownSalesParticipation = createMongoStaffSalesInvolvementHandler(db,client,access.authorize,'self');
  const publicSettings = createMongoPublicVerificationSettingsHandler(db, client, access.authorize);
  const profilePhoto = createMongoProfilePhotoHandler(db, client, {
    resolveStaff: access.resolve,
    identity: async (req) => (await sessions.read(req))?.user ?? null,
    objects,
  });
  const address = createAddressHandler(access.authorize);
  const portal = createMongoCustomerHandlers(db, client, {
    env,
    getIdentity: async (headers) => (await auth.api.getSession({ headers }))?.user ?? null,
    authorizeStaff: access.authorize,
  });
  const officialForms = createMongoOfficialFormsHandler(db, client, access.authorize);
  const media = createMongoMediaHandlers(db, client, access.authorize, mediaStore, env, options.trustedOrigins);
  const identity = createAuthNodeHandler(auth.handler, options.baseURL, {
    clientIp: runtimeOptions.clientIp,
  });
  const col = (name: string) => db.collection<MongoRow>(name);

  const business = async (path: string, req: VercelRequest, res: VercelResponse) => {
    if (!isFeaturePathEnabled(`/api/v1/${path}`)) return fail(res, 'NOT_FOUND', 'Not found', 404);
    if (req.method !== 'GET' && !['auth/customer/activate'].includes(path)) {
      const origin = requestHeaders(req).get('origin');
      if (!origin || !options.trustedOrigins.includes(origin))
        return fail(res, 'FORBIDDEN', 'Untrusted request origin', 403);
    }
    const setPath = (value: string) => {
      req.query.familyPath = value;
    };
    if (path === 'auth/customer/activate') {
      setPath('customer/activate');
      return portal.activate(req, res);
    }
    if (path === 'auth/portals' && req.method === 'GET') {
      const session = await sessions.read(req);
      if (!session) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      const id = session.user.id;
      const [staff, assignment, customer, ost] = await Promise.all([
        col('staff_users').findOne({ _id: id }),
        col('staff_role_assignments').findOne({ staff_id: id }),
        col('customers').findOne({ auth_user_id: id }),
        col('ost_members').findOne({ $or: [{ _id: id }, { auth_user_id: id }] }),
      ]);
      const role = assignment
        ? await col('roles').findOne({ _id: String(assignment.role_id) })
        : null;
      return res.status(200).json(
        authPortalsSchema.parse({
          staff: staff
            ? {
                roleSlug: role?.slug ?? null,
                roleName: role?.name ?? null,
                status: staff.status,
                mustChangePassword: staff.must_change_password === true,
              }
            : null,
          customer: customer ? { status: customer.status } : null,
          ost: ost ? { status: ost.status, ostNumber: ost.ost_number } : null,
        }),
      );
    }
    if (path === 'admin/afhomes/session' && req.method === 'GET') {
      const principal = await access.resolve(req);
      if ('error' in principal) return deny(res, principal);
      const { userId: _, ...view } = principal;
      return res.status(200).json(view);
    }
    if (path === 'admin/afhomes/public-verification-settings') return publicSettings(req,res);
    if (path === 'admin/afhomes/dashboard' && req.method === 'GET') {
      const principal = await access.authorize(req, 'dashboard.view');
      if ('error' in principal) return deny(res, principal);
      return res.status(200).json(await mongoDashboard(db, String(req.query.range ?? 'month')));
    }
    if (path === 'admin/afhomes/session/password' && req.method === 'POST') {
      const principal = await access.resolve(req);
      if ('error' in principal) return deny(res, principal);
      const parsed = changeAfHomesStaffPasswordSchema.safeParse(req.body);
      if (!parsed.success)
        return fail(res, 'VALIDATION_ERROR', 'Enter the current and a new password', 400);
      const account = await col('auth_accounts').findOne({
        userId: principal.userId,
        providerId: 'credential',
      });
      if (
        !account ||
        typeof account.password !== 'string' ||
        !(await verifyPassword({ hash: account.password, password: parsed.data.currentPassword }))
      )
        return fail(res, 'UNAUTHORIZED', 'Current password is incorrect', 401, {
          reason: 'CURRENT_PASSWORD_INVALID',
        });
      const current = await sessions.read(req);
      if (!current) return fail(res, 'UNAUTHORIZED', 'Your session has expired', 401);
      const hashed = await hashPassword(parsed.data.newPassword),
        session = client.startSession();
      try {
        const changed = await session.withTransaction(async () => {
          const update = await col('auth_accounts').updateOne(
            { _id: account._id, password: account.password },
            { $set: { password: hashed, updatedAt: new Date() } },
            { session },
          );
          if (update.modifiedCount !== 1) return false;
          const staff = await col('staff_users').updateOne(
            { _id: principal.userId, status: 'active' },
            {
              $set: {
                must_change_password: false,
                password_changed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            },
            { session },
          );
          if (staff.matchedCount !== 1) throw new Error('Staff standing changed');
          await col('auth_sessions').deleteMany(
            { userId: principal.userId, _id: { $ne: current.session.id } },
            { session },
          );
          await col('auth_session_assurance').deleteMany(
            { user_id: principal.userId, _id: { $ne: current.session.id } },
            { session },
          );
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: principal.userId,
              action: 'STAFF_PASSWORD_CHANGED',
              entity_type: 'staff_user',
              entity_id: principal.userId,
              after_data: { email: principal.email },
              created_at: new Date(),
            },
            { session },
          );
          return true;
        });
        return changed
          ? res.status(200).json({ changed: true })
          : fail(res, 'CONFLICT', 'Password changed concurrently. Sign in again.', 409);
      } finally {
        await session.endSession();
      }
    }
    if (path === 'admin/afhomes/session' && req.method === 'PATCH') {
      const principal = await access.resolve(req);
      if ('error' in principal) return deny(res, principal);
      const parsed = updateAfHomesStaffProfileSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid profile', 400);
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await col('staff_users').updateOne(
            { _id: principal.userId, status: 'active' },
            { $set: { full_name: parsed.data.name, updated_at: new Date().toISOString() } },
            { session },
          );
          await col('auth_users').updateOne(
            { _id: principal.userId },
            { $set: { name: parsed.data.name, updatedAt: new Date() } },
            { session },
          );
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: principal.userId,
              action: 'STAFF_PROFILE_UPDATED',
              entity_type: 'staff_user',
              entity_id: principal.userId,
              after_data: { name: parsed.data.name },
              created_at: new Date(),
            },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      return res.status(200).json({ ...principal, fullName: parsed.data.name });
    }
    if (/^admin\/afhomes\/(roles|departments|staff)(\/|$)/.test(path)) {
      setPath(path.slice('admin/afhomes/'.length));
      return organization(req, res);
    }
    if (path === 'earning/adjust' && req.method === 'POST') return pointsAdjustment(req,res);
    if (path === 'sales-involvement') { setPath(''); return ownSalesParticipation(req,res); }
    for (const [family, handler] of Object.entries({
      'card-products': catalog.plans,
      'card-categories': catalog.categories,
      customers,
      documents: documents.handler,
      sales,
      commissions,
      queues,
      memberships,
      members,
      referrals,
      genealogy,
      analytics,
      'customer-imports': (req: VercelRequest, res: VercelResponse) => {
        const path = String(req.query.familyPath ?? '');
        if (path === 'parse' || path === 'jobs' || path.startsWith('jobs/') || path.startsWith('template/')) return importJobs(req,res);
        return path === 'continuations' || /^(?:rows|sources)\/[^/]+\/(?:intake|continuation)$/.test(path)
          ? importContinuation.handler(req, res) : importClaims.handler(req, res);
      },
      address,
      media: media.handler,
      customer: portal.portal,
      'official-forms': officialForms,
      'ist-portal': istPortal,
      'sale-team': saleTeam,
      'ost-accreditation': ostAccreditation,
      ost,
      'profile-photo': profilePhoto,
    })) {
      if (path !== family && !path.startsWith(`${family}/`)) continue;
      const suffix = path.slice(family.length).replace(/^\//, '');
      setPath(suffix);
      if (family === 'customers' && /^[a-f0-9-]{36}\/onboarding-token$/.test(suffix))
        return portal.staffToken(req, res);
      return handler(req, res);
    }
    if (path === 'health' && req.method === 'GET') {
      await db.command({ ping: 1 });
      return res.status(200).json({ ok: true });
    }
    if (
      (!FEATURE_FLAGS.redemption && path.startsWith('redemptions')) ||
      (!FEATURE_FLAGS.services && path.startsWith('earning'))
    )
      return fail(res, 'NOT_FOUND', 'Not found', 404);
    return fail(res, 'NOT_FOUND', 'This route is not part of the converted Phase 5 runtime', 404);
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url ?? '/', options.baseURL).pathname;
      if (await documents.upload(req,res)) return;
      if (await importClaims.upload(req, res)) return;
      if (await media.upload(req, res)) return;
      if (mediaStore?.serve && (await mediaStore.serve(req, res))) return;
      if (objects?.serve && (await objects.serve(req, res))) return;
      if (path.startsWith('/api/v1/auth/identity/')) return await identity(req, res);
      if (!path.startsWith('/api/v1/')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const bodySizeLimit = req.method === 'POST' && path === '/api/v1/customer-imports/parse'
        ? 4 * Math.ceil(MAX_IMPORT_BYTES / 3) + 4096
        : path.startsWith('/api/v1/profile-photo/') || (req.method === 'POST' && ['/api/v1/members','/api/v1/members/ost'].includes(path))
        ? 4 * Math.ceil(PROFILE_PHOTO_MAX_BYTES / 3) + 4096
        : 65_536;
      const request = getRequest({ request: req, base: options.baseURL, bodySizeLimit });
      let body: unknown;
      if (!['GET', 'HEAD'].includes(req.method ?? 'GET')) {
        const text = await request.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            await setResponse(
              res,
              Response.json(
                { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } },
                { status: 400 },
              ),
            );
            return;
          }
        }
      }
      const responseHeaders: Record<string, string | string[]> = {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      };
      let status = 200;
      const response: VercelResponse = {
        setHeader: (key, value) => {
          responseHeaders[key] = value;
        },
        status: (value) => {
          status = value;
          return response;
        },
        json: (value) => {
          res.writeHead(status, responseHeaders);
          res.end(JSON.stringify(value));
        },
        end: () => {
          res.writeHead(status, responseHeaders);
          res.end();
        },
      };
      await business(
        path.slice('/api/v1/'.length),
        {
          method: req.method,
          query: Object.fromEntries(new URL(request.url).searchParams),
          headers: req.headers,
          socket: { remoteAddress: req.socket.remoteAddress },
          body,
        },
        response,
      );
    } catch {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Service is unavailable' } }));
      } else res.destroy();
    }
  };
}
