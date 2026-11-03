import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { PublicSaleTeamSearchStore } from './sale-team-public-search.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { readMongoPublicVerificationSettings } from './public-verification-settings.mongo.js';

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
  read: (id: string, session: ClientSession) => Promise<Record<string, unknown> | null>,
  objects?: PrivateObjectStore,
): PublicSaleTeamSearchStore {
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
  async function lookup(aa: string, session: ClientSession) {
    const record = await col('sale_team_accreditations').findOne(
      { aa_number: aa },
      { session, projection: { staff_id: 1 } },
    );
    if (!record) return null;
    const result = await read(String(record.staff_id), session);
    return result?.status === 'accredited' ? { ...result, staffId: record.staff_id } : null;
  }
  return {
    async settings() {
      const saved = await col('public_verification_settings').findOne({ _id: 'public' });
      return saved ? readMongoPublicVerificationSettings(db) : null;
    },
    async begin(ip, aa) {
      return serialized(ip, async (session) => {
        const now = Date.now();
        const state = await col('sale_team_search_attempts').findOne({ _id: ip }, { session });
        const cooldown = Number(state?.cooldown_until ?? 0);
        if (cooldown > now)
          return { allowed: false, retryAfter: Math.max(1, Math.ceil((cooldown - now) / 1000)) };
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
          };
        attempts++;
        if (!(await lookup(aa, session))) invalid++;
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
        return { allowed: until <= now, retryAfter: until > now ? 300 : 0 };
      });
    },
    async contactExists(id) {
      return !!(await col('sale_team_search_contacts').findOne(
        { _id: id },
        { projection: { _id: 1 } },
      ));
    },
    async saveContact(key, contact) {
      const record = await col('sale_team_search_contacts').findOneAndUpdate(
        { dedupe_key: key },
        {
          $setOnInsert: {
            _id: randomUUID(),
            dedupe_key: key,
            name: contact.name,
            email: contact.email,
            mobile: contact.mobile,
            created_at: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      return record!._id;
    },
    async reveal(args) {
      const ip = String(args.p_ip_hash),
        request = String(args.p_request_id),
        aa = String(args.p_aa_number);
      return serialized(ip, async (session) => {
        if (
          !(await db.collection<{_id:string;read_guard?:number}>('sale_team_search_contacts').findOneAndUpdate(
            { _id: String(args.p_contact_id) },
            {$inc:{read_guard:1}},
            { session,returnDocument:'after' },
          ))
        )
          throw new Error('Contact required');
        const now = new Date(),
          start = new Date(now.valueOf() - 86400000);
        const retry = await col('sale_team_search_disclosures').findOne(
          { ip_hash: ip, request_id: request },
          { session },
        );
        const previous = await col('sale_team_search_disclosures')
          .find({ ip_hash: ip, disclosed_at: { $gt: start } }, { session })
          .sort({ disclosed_at: 1 })
          .toArray();
        const settings = await col('public_verification_settings').findOne(
          { _id: 'public' },
          { session },
        );
        if (!retry && previous.length >= 3 && settings?.dailyLimitEnabled !== false)
          return {
            limited: true,
            retryAfter: Math.max(
              1,
              Math.ceil(
                (new Date(previous[0]!.disclosed_at as Date).valueOf() + 86400000 - now.valueOf()) /
                  1000,
              ),
            ),
            result: null,
          };
        const result = await lookup(aa, session);
        if (result && !retry)
          await col('sale_team_search_disclosures').insertOne(
            {
              _id: randomUUID(),
              ip_hash: ip,
              request_id: request,
              notice_version: args.p_notice_version,
              disclosed_at: now,
            },
            { session },
          );
        return { limited: false, retryAfter: 0, result };
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
