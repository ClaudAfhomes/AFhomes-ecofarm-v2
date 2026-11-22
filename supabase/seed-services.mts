/**
 * Starter service catalog and points rules, taken from the public Experiences pages
 * (packages/ui/src/website-content/data/experiences.ts).
 *
 * Every value here is a STARTER value chosen on the owner's instruction of
 * 2026-11-21 ("make the amount reasonable … just for now but still configurable").
 * Nothing is hardcoded in the application: each row is ordinary catalog/rule data
 * that an admin can edit or deactivate on Catalog → Points Rules.
 *
 *   earning:  points per unit = 10% of the price (the owner's own example:
 *             Teppanyaki at 2,000 per head earns 200 points), all card tiers.
 *   spending: 1 point = 1 peso, all tiers.
 *             - hotel rooms are staycation services (accommodation rule);
 *             - dining, events and resort services get a one-year, named launch
 *               promotion, because spending on a non-staycation service is only
 *               ever allowed through a dated promotion (no indefinite ones).
 *   Services are NOT published on the website; an admin publishes each one.
 *
 * Safe to re-run: a service is matched by name (case-insensitive) and skipped if
 * it exists; a rule is skipped if the service already has an active one.
 * Writes go through public.save_service_catalog (same path and audit as the UI);
 * rules get the same audit rows the API writes.
 *
 * Usage (DATABASE_URL must point at the target):
 *   tsx supabase/seed-services.ts                      dry run, rolls back
 *   tsx supabase/seed-services.ts --apply              commit (non-production)
 *   tsx supabase/seed-services.ts --apply --approve-production   production
 *   optional --actor=<staff email>  (default: the active Super Admin)
 */
import { Client } from 'pg';

const PRODUCTION_REF = 'ikaevepedpqygdlipsei';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const approveProduction = args.includes('--approve-production');
const actorEmail = args.find((a) => a.startsWith('--actor='))?.slice('--actor='.length);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const isProduction =
  connectionString.includes(PRODUCTION_REF) ||
  process.env.AFHOMES_TARGET_PROJECT_REF === PRODUCTION_REF;
if (apply && isProduction && !approveProduction)
  throw new Error('Refusing to write to production without --approve-production.');

type Unit = 'unit' | 'person' | 'session' | 'night' | 'booking';
interface Starter {
  name: string;
  category: string;
  location: string;
  price: string;
  unit: Unit;
  points: number;
  staycation: boolean;
  availability: 'available' | 'coming_soon';
  summary: string;
  highlights: string[];
}

const HOTEL = 'Alaminos, Laguna';
const RESORT = 'Calauan, Laguna';
const STARTERS: Starter[] = [
  {
    name: 'Signature Suite',
    category: 'Smart Wellness Hotel',
    location: HOTEL,
    price: '12000.00',
    unit: 'night',
    points: 1200,
    staycation: true,
    availability: 'available',
    summary: 'The hotel’s one Signature Suite, with smart sleep support and a Smart Sleep Report.',
    highlights: ['Non-contact sleep intelligence', 'Negative Ion Refreshers', 'Smart Sleep Report'],
  },
  {
    name: 'Smart Wellness Room',
    category: 'Smart Wellness Hotel',
    location: HOTEL,
    price: '5500.00',
    unit: 'night',
    points: 550,
    staycation: true,
    availability: 'available',
    summary: 'One of 17 Smart Wellness Rooms designed around restful sleep.',
    highlights: ['Adaptive environmental support', 'Smart Sleep Report'],
  },
  {
    name: 'Smart Wellness Lounge Pass',
    category: 'Smart Wellness Hotel',
    location: HOTEL,
    price: '800.00',
    unit: 'person',
    points: 80,
    staycation: false,
    availability: 'available',
    summary: 'Day access to the Smart Wellness Hotel Lounge.',
    highlights: ['Wellness-oriented lounge'],
  },
  {
    name: 'Teppanyaki Dinner',
    category: 'ALM Japanese Restaurant',
    location: HOTEL,
    price: '2000.00',
    unit: 'person',
    points: 200,
    staycation: false,
    availability: 'available',
    summary: 'Live Teppanyaki at the ALM Japanese Restaurant.',
    highlights: ['Live culinary performance', 'Upscale lounge & reception'],
  },
  {
    name: 'Private Family Gathering',
    category: 'ALM Japanese Restaurant',
    location: HOTEL,
    price: '25000.00',
    unit: 'booking',
    points: 2500,
    staycation: false,
    availability: 'available',
    summary: 'A private dining room booking for family celebrations.',
    highlights: ['Private dining area', 'Dedicated kitchen team'],
  },
  {
    name: 'Corporate Event Package',
    category: 'ALM Japanese Restaurant',
    location: HOTEL,
    price: '1500.00',
    unit: 'person',
    points: 150,
    staycation: false,
    availability: 'available',
    summary: 'Corporate dining and events, priced per guest.',
    highlights: ['Corporate events', 'Industrial-scale kitchen'],
  },
  {
    name: 'Hotspring Day Pass',
    category: 'Hotspring & Ecofarm Resort',
    location: RESORT,
    price: '1000.00',
    unit: 'person',
    points: 100,
    staycation: false,
    availability: 'coming_soon',
    summary: 'Day access to the natural geothermal springs (opening in phases).',
    highlights: ['Natural geothermal springs', 'Mountain & countryside views'],
  },
  {
    name: 'Ecofarm Tour',
    category: 'Hotspring & Ecofarm Resort',
    location: RESORT,
    price: '600.00',
    unit: 'person',
    points: 60,
    staycation: false,
    availability: 'coming_soon',
    summary: 'A guided ecofarm tour with farming education (opening in phases).',
    highlights: ['Integrated ecofarm', 'Farming education'],
  },
];

const TIERS = ['BRONZE', 'SILVER', 'GOLD'];
const PESO_PER_POINT = '1';
const PROMOTION_REFERENCE = 'Starter points spending on AF Homes services (launch)';

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}
function oneYearAfter(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(y) + 1}-${m}-${d === '29' && m === '02' ? '28' : d}`;
}

const client = new Client({
  connectionString,
  ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query('begin');
  const actor = await client.query<{ id: string; email: string }>(
    actorEmail
      ? `select id, email from public.staff_users where lower(email) = lower($1) and status = 'active'`
      : `select su.id, su.email from public.staff_users su
           join public.staff_role_assignments a on a.staff_id = su.id
           join public.roles r on r.id = a.role_id
          where r.slug = 'super_admin' and su.status = 'active'
          order by su.created_at limit 1`,
    actorEmail ? [actorEmail] : [],
  );
  const actorId = actor.rows[0]?.id;
  if (!actorId) throw new Error('No active staff actor found (pass --actor=<email>).');

  const start = manilaToday();
  const end = oneYearAfter(start);
  const report: string[] = [];
  for (const s of STARTERS) {
    const existing = await client.query<{ id: string; is_staycation_eligible: boolean }>(
      `select id, is_staycation_eligible from public.service_catalog
        where lower(btrim(name)) = lower($1) order by created_at limit 1`,
      [s.name],
    );
    let serviceId = existing.rows[0]?.id;
    if (serviceId) {
      report.push(`= ${s.name}: already in the catalog, left unchanged`);
    } else {
      const saved = await client.query<{ id: string }>(
        `select id from public.save_service_catalog(null, $1::jsonb, $2)`,
        [
          JSON.stringify({
            name: s.name,
            basePrice: s.price,
            pricingUnit: s.unit,
            category: s.category,
            location: s.location,
            summary: s.summary,
            highlights: s.highlights,
            description: null,
            isActive: true,
            isStaycationEligible: s.staycation,
            published: false,
            availability: s.availability,
          }),
          actorId,
        ],
      );
      serviceId = saved.rows[0]!.id;
      report.push(`+ ${s.name}: ₱${s.price} per ${s.unit}`);
    }
    const staycation = existing.rows[0]?.is_staycation_eligible ?? s.staycation;

    const earning = await client.query(
      `select 1 from public.point_earning_rules
        where service_id = $1 and is_active and effective_end > $2::date limit 1`,
      [serviceId, start],
    );
    if (earning.rowCount === 0) {
      const rule = await client.query<{ id: string }>(
        `insert into public.point_earning_rules
           (service_id, points_amount, eligible_tiers, effective_start, effective_end,
            is_active, min_quantity, max_award, promotion_reference, created_by)
         values ($1, $2, $3, $4, $5, true, 1, null, null, $6) returning id`,
        [serviceId, s.points, TIERS, start, end, actorId],
      );
      await client.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
         values ($1, 'EARNING_RULE_CREATED', 'point_earning_rules', $2, null, $3)`,
        [
          actorId,
          rule.rows[0]!.id,
          JSON.stringify({
            serviceId,
            pointsAmount: s.points,
            eligibleTiers: TIERS,
            minQuantity: 1,
            maxAward: null,
            promotionReference: null,
          }),
        ],
      );
      report.push(`  earns ${s.points} points per ${s.unit} until ${end}`);
    }

    const spending = await client.query(
      `select 1 from public.point_redemption_rules
        where service_id = $1 and is_active and effective_end > $2::date limit 1`,
      [serviceId, start],
    );
    if (spending.rowCount === 0) {
      const kind = staycation ? 'accommodation' : 'promotion';
      const rule = await client.query<{ id: string }>(
        `insert into public.point_redemption_rules
           (service_id, rule_kind, peso_value_per_point, eligible_tiers, min_points, max_points,
            min_purchase_amount, effective_start, effective_end, is_active, promotion_reference,
            created_by)
         values ($1, $2, $3, $4, 1, null, null, $5, $6, true, $7, $8) returning id`,
        [serviceId, kind, PESO_PER_POINT, TIERS, start, end, PROMOTION_REFERENCE, actorId],
      );
      await client.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
         values ($1, 'REDEMPTION_RULE_CREATED', 'point_redemption_rules', $2, null, $3)`,
        [
          actorId,
          rule.rows[0]!.id,
          JSON.stringify({
            serviceId,
            ruleKind: kind,
            pesoValuePerPoint: PESO_PER_POINT,
            eligibleTiers: TIERS,
            effectiveStart: start,
            effectiveEnd: end,
            promotionReference: PROMOTION_REFERENCE,
            allowDiscountStacking: false,
          }),
        ],
      );
      report.push(`  points spendable at ₱${PESO_PER_POINT}/point (${kind}) until ${end}`);
    }
  }
  console.log(report.join('\n'));
  if (apply) {
    await client.query('commit');
    console.log('[afhomes:seed-services] Committed.');
  } else {
    await client.query('rollback');
    console.log('[afhomes:seed-services] Dry run only; rolled back. Add --apply to commit.');
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
