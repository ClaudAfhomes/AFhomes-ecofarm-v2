import type { Db, MongoClient } from 'mongodb';
import { cardQrPayload } from './identifier.js';
import {
  createCustomerActivation,
  CustomerActivationError,
  type MongoRow,
} from './customer-activation.mongo.js';
import { deny, fail, isoOrNull, jsonBody, list, method, subPath } from './handler-kit.js';
import { getAuthOptions } from './auth.js';
import { createMongoCustomerPoints } from './customer-points.mongo.js';
import type { VercelRequest, VercelResponse } from './http.js';
import type { toErrorEnvelope } from './envelope.js';

type Dependencies = {
  env: NodeJS.ProcessEnv;
  getIdentity(headers: Headers): Promise<{ id: string } | null>;
  authorizeStaff(
    req: VercelRequest,
    module: 'sales.customers',
    action: 'update',
  ): Promise<{ userId: string } | { error: ReturnType<typeof toErrorEnvelope> }>;
};
const headersOf = (req: VercelRequest) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
  }
  return headers;
};

/** Unmounted Phase 5 boundary. Staff grants and cookie verification are server capabilities. */
export function createMongoCustomerHandlers(
  db: Db,
  client: MongoClient,
  dependencies: Dependencies,
) {
  const activation = createCustomerActivation(db, client, dependencies.env);
  const points = createMongoCustomerPoints(db, client);
  const collection = (name: string) => db.collection<MongoRow>(name);
  const guard =
    (work: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) =>
    async (req: VercelRequest, res: VercelResponse) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        return await work(req, res);
      } catch (error) {
        if (error instanceof CustomerActivationError)
          return fail(
            res,
            error.status >= 500
              ? 'INTERNAL'
              : error.status === 404
                ? 'NOT_FOUND'
                : error.status === 403
                  ? 'FORBIDDEN'
                  : error.status === 400
                    ? 'VALIDATION_ERROR'
                    : 'CONFLICT',
            error.message,
            error.status,
          );
        return fail(res, 'INTERNAL', 'Customer account service is unavailable', 503);
      }
    };
  return {
    activate: guard(async (req, res) => {
      if (method(req) !== 'POST' || subPath(req) !== 'customer/activate')
        return fail(res, 'NOT_FOUND', 'Not found', 404);
      return res.status(201).json(await activation.redeem(jsonBody(req)));
    }),
    staffToken: guard(async (req, res) => {
      const match = subPath(req).match(/^([0-9a-f-]{36})\/onboarding-token$/);
      if (method(req) !== 'POST' || !match) return fail(res, 'NOT_FOUND', 'Not found', 404);
      const auth = await dependencies.authorizeStaff(req, 'sales.customers', 'update');
      if ('error' in auth) return deny(res, auth);
      // Cookie sessions require CSRF protection outside Better Auth's own endpoints too.
      const origin = headersOf(req).get('origin');
      if (!origin || !getAuthOptions(dependencies.env).trustedOrigins.includes(origin))
        return fail(res, 'FORBIDDEN', 'Untrusted request origin', 403);
      return res.status(201).json(await activation.issue(match[1]!, auth.userId));
    }),
    portal: guard(async (req, res) => {
      const path = subPath(req);
      const rotating = path === 'membership/credentials' && method(req) === 'POST';
      if (
        !rotating &&
        (method(req) !== 'GET' ||
          !['', 'membership', 'points', 'points/position', 'points/ledger', 'payments'].includes(
            path,
          ))
      )
        return fail(res, 'NOT_FOUND', 'Not found', 404);
      const identity = await dependencies.getIdentity(headersOf(req));
      if (!identity) return fail(res, 'UNAUTHORIZED', 'Sign in to continue', 401);
      // Re-resolve ownership and standing on every request; never accept customerId from query/body.
      const owner = await collection('customers').findOne(
        { auth_user_id: identity.id },
        {
          projection: {
            _id: 1,
            customer_number: 1,
            customer_code: 1,
            first_name: 1,
            middle_name: 1,
            last_name: 1,
            suffix: 1,
            email: 1,
            phone: 1,
            birth_date: 1,
            address: 1,
            status: 1,
            updated_at: 1,
          },
        },
      );
      if (!owner) return fail(res, 'FORBIDDEN', 'Customer access required', 403);
      if (path === '') {
        const address = (owner.address ?? {}) as Record<string, unknown>;
        return res.status(200).json({
          id: owner._id,
          customerNumber: owner.customer_number,
          customerCode: owner.customer_code ?? null,
          firstName: owner.first_name,
          middleName: isoOrNull(owner.middle_name),
          lastName: owner.last_name,
          suffix: isoOrNull(owner.suffix),
          fullName: [owner.first_name, owner.middle_name, owner.last_name, owner.suffix]
            .filter(Boolean)
            .join(' '),
          email: owner.email,
          phone: owner.phone,
          dateOfBirth: isoOrNull(owner.birth_date),
          addressLine1: isoOrNull(address.line1),
          addressLine2: isoOrNull(address.line2),
          city: isoOrNull(address.city),
          province: isoOrNull(address.province),
          countryCode: isoOrNull(address.countryCode ?? address.country_code),
          status: owner.status,
          activatedAt: isoOrNull(owner.updated_at),
          updatedAt: isoOrNull(owner.updated_at) ?? '',
        });
      }
      if (owner.status !== 'active')
        return fail(
          res,
          'FORBIDDEN',
          `Your account is ${owner.status}. Contact AFHomes Ecofarm to restore access.`,
          403,
        );
      if (rotating) {
        const origin = headersOf(req).get('origin');
        if (!origin || !getAuthOptions(dependencies.env).trustedOrigins.includes(origin))
          return fail(res, 'FORBIDDEN', 'Untrusted request origin', 403);
        return res.status(201).json(await points.rotate(identity.id, owner._id));
      }
      if (path === 'points/position')
        return res.status(200).json(await points.position(identity.id, owner._id));
      if (path === 'payments') {
        const sales = await collection('card_sales')
          .find({ customer_id: owner._id }, { projection: { _id: 1 } })
          .toArray();
        const payments = await collection('payments')
          .find(
            { sale_id: { $in: sales.map((sale) => sale._id) } },
            {
              projection: {
                _id: 1,
                sale_id: 1,
                payment_number: 1,
                amount: 1,
                payment_type: 1,
                method: 1,
                reference: 1,
                status: 1,
                recorded_at: 1,
                verified_at: 1,
              },
            },
          )
          .sort({ recorded_at: -1 })
          .limit(100)
          .toArray();
        return list(
          res,
          payments.map((row) => ({
            id: row._id,
            paymentNumber: row.payment_number ?? null,
            saleId: row.sale_id,
            amount: row.amount,
            paymentType: isoOrNull(row.payment_type),
            method: row.method,
            reference: isoOrNull(row.reference),
            status: row.status,
            recordedAt: isoOrNull(row.recorded_at) ?? '',
            verifiedAt: isoOrNull(row.verified_at),
          })),
        );
      }
      const membership = await collection('memberships').findOne(
        { customer_id: owner._id, status: 'active' },
        {
          sort: { activated_at: -1 },
          projection: {
            _id: 1,
            sale_id: 1,
            membership_number: 1,
            status: 1,
            product_id: 1,
            activated_at: 1,
            expires_at: 1,
            renewal_due_at: 1,
            yearly_points_allocated: 1,
            points_balance: 1,
          },
        },
      );
      if (!membership) return fail(res, 'NOT_FOUND', 'No active membership found', 404);
      if (path === 'points/ledger')
        return res.status(200).json(await points.ledger(membership._id, req.query ?? {}));
      if (path === 'membership') {
        const plan = await collection('card_plans').findOne(
          { _id: String(membership.product_id) },
          { projection: { name: 1, code: 1 } },
        );
        const sale = await collection('card_sales').findOne(
          { _id: String(membership.sale_id), customer_id: owner._id },
          { projection: { payment_scheme: 1, validity_months_snapshot: 1 } },
        );
        const months = Number(sale?.validity_months_snapshot ?? 0),
          memberCode = String(membership.membership_number ?? '');
        return res.status(200).json({
          id: membership._id,
          membershipNumber: memberCode,
          productName: isoOrNull(plan?.name),
          productCode: isoOrNull(plan?.code),
          status: membership.status,
          activatedAt: isoOrNull(membership.activated_at),
          expiresAt: isoOrNull(membership.expires_at),
          renewalDueAt: isoOrNull(membership.renewal_due_at),
          yearlyPointsAllocated: Number(membership.yearly_points_allocated ?? 0),
          pointsBalance: Number(membership.points_balance ?? 0),
          paymentScheme: sale?.payment_scheme ?? 'spot_cash',
          validityYears: months > 0 && months % 12 === 0 ? months / 12 : null,
          credentialsAvailable: false,
          credentialsNote:
            'Your member code and QR below never change - show them at any AFHomes Ecofarm desk. Only a SHA-256 hash of the separate one-time card secret is stored, so that secret cannot be displayed again; request a new one only if the printed secret is lost, and the previous secret stops working immediately.',
          memberCode,
          qrPayload: cardQrPayload(memberCode),
        });
      }
      const account = await collection('points_accounts').findOne(
        { membership_id: membership._id },
        {
          projection: {
            membership_id: 1,
            balance: 1,
            lifetime_allocated: 1,
            lifetime_redeemed: 1,
            updated_at: 1,
          },
        },
      );
      if (!account) return fail(res, 'NOT_FOUND', 'No points account found', 404);
      return res.status(200).json({
        membershipId: membership._id,
        balance: Number(account.balance ?? 0),
        lifetimeAllocated: Number(account.lifetime_allocated ?? 0),
        lifetimeRedeemed: Number(account.lifetime_redeemed ?? 0),
        updatedAt: isoOrNull(account.updated_at) ?? '',
      });
    }),
  };
}
