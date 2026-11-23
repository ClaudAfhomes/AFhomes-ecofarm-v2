import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { TransactionalSearchStore } from './sale-team-public-search.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { readSavedMongoPublicVerificationSettings } from './public-verification-settings.mongo.js';

/** Operator/test initialization only. Search requests never create indexes. */
export async function setupMongoPublicSearch(db: Db) {
  await db.collection('sale_team_search_contacts').createIndex({ dedupe_key: 1 }, { unique: true });
  await db
    .collection('sale_team_search_disclosures')
    .createIndex({ ip_hash: 1, request_id: 1 }, { unique: true });
  await db.collection('sale_team_search_disclosures').createIndex({ ip_hash: 1, disclosed_at: 1 });
  for (const [table,field] of [['sale_team_search_contacts','created_at'],['sale_team_search_attempts','updated_at'],['background_jobs','name'],['counters','last_used_at']])
    await db.collection(table!).createIndex({[field!]:1});
}

export function createMongoPublicSearchStore(
  db: Db,
  client: MongoClient,
  read: (aaNumber: string, session: ClientSession) => Promise<Record<string, unknown> | null>,
  objects?: PrivateObjectStore,
): TransactionalSearchStore {
  const col = (name: string) => db.collection<MongoRow>(name);
  async function serialized<T>(ip: string, work: (session: ClientSession) => Promise<T>) {
    const session = client.startSession();
    try {
      return await session.withTransaction(async () => {
        await db
          .collection<{ _id: string; seq: number;last_used_at?:Date }>('counters')
          .updateOne(
            { _id: `public-search:${ip}` },
            { $inc: { seq: 1 },$set:{last_used_at:new Date()} },
            { session, upsert: true },
          );
        return work(session);
      });
    } finally {
      await session.endSession();
    }
  }
  /** Increments the per-IP counters and returns the one lookup, so callers never repeat it. */
  async function throttle(ip: string, aa: string, session: ClientSession) {
    const now = Date.now();
    const state = await col('sale_team_search_attempts').findOne({ _id: ip }, { session });
    const cooldown = Number(state?.cooldown_until ?? 0);
    if (cooldown > now)
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((cooldown - now) / 1000)), found: null };
    let window = Number(state?.window_started ?? now),
      attempts = Number(state?.attempts ?? 0);
    let invalidWindow = Number(state?.invalid_started ?? now),
      invalid = Number(state?.invalid_attempts ?? 0);
    if (window <= now - 60000) {
      window = now;
      attempts = 0;
    }
    if (invalidWindow <= now - 300000) {
      invalidWindow = now;
      invalid = 0;
    }
    if (attempts >= 30)
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((window + 60000 - now) / 1000)),
        found: null,
      };
    attempts++;
    const found = await read(aa, session);
    if (!found) invalid++;
    const until = invalid >= 20 ? now + 300000 : cooldown;
    await col('sale_team_search_attempts').updateOne(
      { _id: ip },
      {
        $set: {
          window_started: window,
          attempts,
          invalid_started: invalidWindow,
          invalid_attempts: invalid,
          cooldown_until: until,
          updated_at: new Date(now),
        },
      },
      { session, upsert: true },
    );
    return { allowed: until <= now, retryAfter: until > now ? 300 : 0, found };
  }
  /** The daily disclosure allowance and its record, for an already-looked-up result. */
  async function disclose(
    ip: string,
    request: string,
    noticeVersion: unknown,
    result: Record<string, unknown> | null,
    session: ClientSession,
  ) {
    const now = new Date(),
      start = new Date(now.valueOf() - 86400000);
    // One read: this IP's last 24 hours, plus this request's own record however old it is.
    const rows = await col('sale_team_search_disclosures')
      .find({ ip_hash: ip, $or: [{ disclosed_at: { $gt: start } }, { request_id: request }] }, { session })
      .sort({ disclosed_at: 1 })
      .toArray();
    const retry = rows.some((row) => row.request_id === request);
    const previous = rows.filter((row) => row.disclosed_at instanceof Date && row.disclosed_at > start);
    const settings = await col('public_verification_settings').findOne({ _id: 'public' }, { session });
    if (!retry && previous.length >= 3 && settings?.dailyLimitEnabled !== false)
      return {
        limited: true,
        retryAfter: Math.max(
          1,
          Math.ceil((new Date(previous[0]!.disclosed_at as Date).valueOf() + 86400000 - now.valueOf()) / 1000),
        ),
        result: null,
      };
    if (result && !retry)
      await col('sale_team_search_disclosures').insertOne(
        {
          _id: randomUUID(),
          ip_hash: ip,
          request_id: request,
          notice_version: noticeVersion,
          disclosed_at: now,
        },
        { session },
      );
    return { limited: false, retryAfter: 0, result };
  }
  const contacts = db.collection<{
    _id: string;
    dedupe_key: string;
    name: string;
    email: string;
    mobile: string;
    created_at: Date;
    read_guard?: number;
  }>('sale_team_search_contacts');
  /** Touches the contact so retention cleanup cannot delete it mid-reveal. */
  const guardContact = (id: string, session: ClientSession) =>
    contacts.findOneAndUpdate({ _id: id }, { $inc: { read_guard: 1 } }, { session, returnDocument: 'after' });
  return {
    settings: () => readSavedMongoPublicVerificationSettings(db),
    async begin(ip, aa) {
      return serialized(ip, async (session) => {
        const { allowed, retryAfter } = await throttle(ip, aa, session);
        return { allowed, retryAfter };
      });
    },
    async revealWithThrottle({ ipHash, aaNumber, requestId, noticeVersion, contactId, contact }) {
      return serialized(ipHash, async (session) => {
        // A stale receipt is refused before it can use any of the caller's allowance.
        if (contactId && !(await guardContact(contactId, session))) return { contactMissing: true };
        const gate = await throttle(ipHash, aaNumber, session);
        if (!gate.allowed) return { throttled: true, retryAfter: gate.retryAfter };
        let id = contactId;
        if (!id) {
          const saved = await contacts.findOneAndUpdate(
            { dedupe_key: contact!.key },
            {
              $setOnInsert: {
                _id: randomUUID(),
                dedupe_key: contact!.key,
                name: contact!.name,
                email: contact!.email,
                mobile: contact!.mobile,
                created_at: new Date(),
              },
              $inc: { read_guard: 1 },
            },
            { upsert: true, returnDocument: 'after', session },
          );
          id = saved!._id;
        }
        return { ...(await disclose(ipHash, requestId, noticeVersion, gate.found, session)), contactId: id };
      });
    },
    async photoUrl(id) {
      if (!objects) return null;
      const photo = await col('profile_photos').findOne({ owner_id: id });
      if (!photo || !(await objects.exists(String(photo.object_key)))) return null;
      return (await objects.downloadURL(String(photo.object_key), 300)).url;
    },
  };
}
