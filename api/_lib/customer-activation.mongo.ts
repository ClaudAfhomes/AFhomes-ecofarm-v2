import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { customerActivationRequestSchema, createCustomerSchema } from '@afhomes/contracts';
import { customerActivationUrl } from './customer-onboarding-url.js';
import { DEFAULT_ONBOARDING_TOKEN_VALID_HOURS } from './constants.js';

export type MongoRow = Record<string, unknown> & {
  _id: string;
  activation_version?: string;
  afhomes_link_version?: string;
  catalog_version?: string;
};
export class CustomerActivationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const rows = (db: Db, name: string) => db.collection<MongoRow>(name);

/** Explicit setup only. Never invoked on import/startup/ping or against Atlas by tests. */
export async function setupCustomerActivation(db: Db) {
  await rows(db, 'customers').createIndex(
    { auth_user_id: 1 },
    {
      unique: true,
      partialFilterExpression: { auth_user_id: { $type: 'string' } },
    },
  );
  await rows(db, 'customer_onboarding_tokens').createIndex({ token_hash: 1 }, { unique: true });
  await rows(db, 'customer_onboarding_tokens').createIndex({ customer_id: 1, purpose: 1 });
  await rows(db, 'auth_users').createIndex({ email: 1 }, { unique: true });
  await rows(db, 'auth_accounts').createIndex({ providerId: 1, accountId: 1 }, { unique: true });
}

/** Caller must authorize staff issuance. Anonymous redemption trusts only the token. */
export function createCustomerActivation(db: Db, client: MongoClient, env: NodeJS.ProcessEnv) {
  if (db.client !== client) throw new Error('Activation requires its matching MongoDB client');
  const inTransaction = async <T>(work: (session: ClientSession) => Promise<T>): Promise<T> => {
    const session = client.startSession();
    try {
      return await session.withTransaction(() => work(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
  };
  const audit = async (
    session: ClientSession,
    actorId: string,
    action: string,
    entityId: string,
    after: object,
    entityType = 'customer',
  ) => {
    await rows(db, 'audit_events').insertOne(
      {
        _id: randomUUID(),
        actor_id: actorId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        after_data: after,
        created_at: new Date(),
      },
      { session },
    );
  };
  const eligible = async (customerId: string, session?: ClientSession) => {
    const customer = await rows(db, 'customers').findOne({ _id: customerId }, { session });
    if (!customer) return refuse(404, 'This activation link is not valid.');
    if (customer.auth_user_id) return refuse(409, 'This customer already has a sign-in.');
    if (customer.status !== 'active') return refuse(409, 'This account is not active.');
    const membership = await rows(db, 'memberships').findOne(
      { customer_id: customerId, status: 'active' },
      { session },
    );
    if (!membership) return refuse(409, 'No active membership was found.');
    if (session) {
      // Serialize activation against membership suspension/expiry updates too.
      await rows(db, 'memberships').updateOne(
        { _id: membership._id, status: 'active' },
        { $set: { activation_guard: randomUUID() } },
        { session },
      );
    }
    return customer;
  };
  return {
    async issue(customerId: string, actorId: string) {
      if (!customerActivationUrl('configuration-check', env))
        return refuse(500, 'Customer portal URL is not configured');
      const token = randomBytes(32).toString('hex');
      const tokenHash = hash(token);
      const expiresAt = new Date(Date.now() + DEFAULT_ONBOARDING_TOKEN_VALID_HOURS * 3_600_000);
      const email = await inTransaction(async (session) => {
        const customer = await eligible(customerId, session);
        // Both issue and redeem write this record, serializing their cross-token races.
        await rows(db, 'customers').updateOne(
          { _id: customerId },
          { $set: { activation_version: randomUUID() } },
          { session },
        );
        await rows(db, 'customer_onboarding_tokens').updateMany(
          { customer_id: customerId, purpose: 'account_activation', consumed_at: null },
          { $set: { consumed_at: new Date(), revoked_at: new Date() } },
          { session },
        );
        await rows(db, 'customer_onboarding_tokens').insertOne(
          {
            _id: randomUUID(),
            customer_id: customerId,
            token_hash: tokenHash,
            purpose: 'account_activation',
            expires_at: expiresAt,
            consumed_at: null,
            created_by: actorId,
            created_at: new Date(),
          },
          { session },
        );
        await audit(session, actorId, 'CUSTOMER_ONBOARDING_TOKEN_ISSUED', customerId, {
          customerId,
          purpose: 'account_activation',
          expiresAt: expiresAt.toISOString(),
          validHours: DEFAULT_ONBOARDING_TOKEN_VALID_HOURS,
          deliveryStatus: 'failed',
        });
        await audit(session, actorId, 'CUSTOMER_ACTIVATION_EMAIL_FAILED', customerId, {
          customerId,
          purpose: 'account_activation',
          expiresAt: expiresAt.toISOString(),
          deliveryStatus: 'failed',
        });
        return String(customer.email);
      });
      // No real delivery is authorized; preserve the existing manual-copy response.
      return {
        status: 'manual_required',
        emailStatus: 'failed',
        email,
        activationUrl: customerActivationUrl(token, env)!,
        expiresAt: expiresAt.toISOString(),
      };
    },

    async redeem(input: unknown) {
      const parsed = customerActivationRequestSchema.safeParse(input);
      if (!parsed.success) return refuse(400, 'Check the activation link and password.');
      const tokenHash = hash(parsed.data.onboardingToken);
      const readToken = async (session?: ClientSession) => {
        const token = await rows(db, 'customer_onboarding_tokens').findOne(
          { token_hash: tokenHash },
          { session },
        );
        if (!token) return refuse(404, 'This activation link is not valid.');
        if (token.purpose !== 'account_activation')
          return refuse(400, 'This link is not an account activation link.');
        if (token.consumed_at) return refuse(409, 'This activation link has already been used.');
        const expiry = new Date(token.expires_at as string | Date).getTime();
        if (!Number.isFinite(expiry) || expiry <= Date.now())
          return refuse(409, 'This activation link has expired. Ask staff for a new one.');
        return token;
      };
      // Reject junk/expired links before expensive hashing; transaction rechecks every condition.
      const preflight = await readToken();
      await eligible(String(preflight.customer_id));
      // Use the provider's password format; no session or plaintext password is persisted here.
      const passwordHash = await hashPassword(parsed.data.password);
      try {
        return await inTransaction(async (session) => {
          const token = await readToken(session);
          const customerId = String(token.customer_id);
          const customer = await eligible(customerId, session);
          const parsedEmail = createCustomerSchema.shape.email.safeParse(customer.email);
          if (!parsedEmail.success) return refuse(500, 'Customer email configuration is invalid');
          const email = parsedEmail.data.trim().toLowerCase();
          const name = [
            customer.first_name,
            customer.middle_name,
            customer.last_name,
            customer.suffix,
          ]
            .filter(Boolean)
            .join(' ');
          const existing = await rows(db, 'auth_users').findOne({ email }, { session });
          const userId = existing?._id ?? randomUUID();
          if (existing) {
            const staff = await rows(db, 'staff_users').findOne(
              { $or: [{ _id: userId }, { auth_user_id: userId }] },
              { session },
            );
            const invitation = await rows(db, 'staff_invitations').findOne(
              { auth_user_id: userId },
              { session },
            );
            const owner = await rows(db, 'customers').findOne(
              { auth_user_id: userId },
              { session },
            );
            if (staff || invitation || owner)
              return refuse(
                409,
                'A sign-in already exists for this email address. Contact staff for help.',
              );
            // Lock the orphan identity as well, preventing two customers claiming it.
            await rows(db, 'auth_users').updateOne(
              { _id: userId },
              { $set: { afhomes_link_version: randomUUID() } },
              { session },
            );
          } else {
            const now = new Date();
            // Pinned Better Auth Mongo models: UUID-string IDs and native Date fields.
            // Persist provider-compatible credentials in the SAME transaction as the claim.
            await rows(db, 'auth_users').insertOne(
              { _id: userId, email, emailVerified: true, name, createdAt: now, updatedAt: now },
              { session },
            );
            await rows(db, 'auth_accounts').insertOne(
              {
                _id: randomUUID(),
                userId,
                accountId: userId,
                providerId: 'credential',
                password: passwordHash,
                createdAt: now,
                updatedAt: now,
              },
              { session },
            );
          }
          const activatedAt = new Date().toISOString();
          const linked = await rows(db, 'customers').updateOne(
            { _id: customerId, auth_user_id: null, status: 'active' },
            {
              $set: {
                auth_user_id: userId,
                updated_at: activatedAt,
                activation_version: randomUUID(),
              },
            },
            { session },
          );
          if (linked.modifiedCount !== 1)
            return refuse(409, 'This customer is already linked to another sign-in.');
          const consumed = await rows(db, 'customer_onboarding_tokens').updateOne(
            { _id: token._id, consumed_at: null, expires_at: { $gt: new Date() } },
            { $set: { consumed_at: new Date(), consumed_by: userId } },
            { session },
          );
          if (consumed.modifiedCount !== 1)
            return refuse(409, 'This activation link is no longer valid.');
          await audit(session, userId, 'CUSTOMER_AUTH_ACTIVATED', customerId, {
            customerNumber: customer.customer_number,
            via: 'onboarding_token',
          });
          await audit(
            session,
            userId,
            'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
            token._id,
            {
              customerId,
              purpose: 'account_activation',
            },
            'customer_onboarding_token',
          );
          await audit(session, userId, 'CUSTOMER_ACCOUNT_LINKED', customerId, {
            authUserId: userId,
          });
          if (existing)
            await audit(session, userId, 'CUSTOMER_EXISTING_AUTH_LINKED', customerId, {
              customerId,
              purpose: 'account_activation',
              via: 'activation_recovery',
              tokenConsumed: true,
            });
          return {
            customerId,
            customerNumber: String(customer.customer_number),
            email,
            fullName: name,
            nextStep: 'sign_in' as const,
            linkedExistingAuth: !!existing,
            ...(!existing ? { activatedAt } : {}),
          };
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
          return refuse(409, 'The account could not be linked. Contact staff for help.');
        throw error;
      }
    },
  };
}
