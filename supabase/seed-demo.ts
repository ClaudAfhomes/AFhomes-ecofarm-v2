/** Explicit preview-only demo seed. Never run automatically or against production. */
import { Client } from 'pg';

const productionRef = 'ikaevepedpqygdlipsei';
const targetRef = process.env.AFHOMES_TARGET_PROJECT_REF;
if (process.env.AFHOMES_ALLOW_DEMO_SEED !== 'true')
  throw new Error('Set AFHOMES_ALLOW_DEMO_SEED=true explicitly.');
if (!targetRef || targetRef === productionRef)
  throw new Error('Demo seed refused for a missing or production project ref.');
if (process.env.VERCEL_ENV === 'production') throw new Error('Demo seed refused in Production.');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`
    insert into public.customers (customer_number,email,phone,first_name,last_name,status)
    values ('DEMO-CUSTOMER-001','preview-customer@example.invalid','+639000000000','Preview','Customer','prospect')
    on conflict (customer_number) do nothing
  `);
  console.log('[afhomes:seed-demo] Preview-only customer created.');
} finally {
  await client.end();
}
