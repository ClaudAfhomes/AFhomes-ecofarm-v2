/** Production-safe AF Homes reference seed. No people, transactions, or credentials. */
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query(`
    insert into public.card_categories (slug, name, sort_order)
    values ('membership', 'Membership Cards', 10)
    on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;
    insert into public.card_plans (category_id, code, name, cash_price, minimum_down_payment, yearly_points)
    select c.id, v.code, v.name, v.cash_price, v.minimum_down_payment, v.yearly_points
    from public.card_categories c
    cross join (values
      ('GOLD','Gold','60000.00','20000.00',60000),
      ('SILVER','Silver','40000.00','15000.00',40000),
      ('BRONZE','Bronze','30000.00','10000.00',25000)
    ) v(code,name,cash_price,minimum_down_payment,yearly_points)
    where c.slug = 'membership'
    on conflict (code) do update set name = excluded.name, cash_price = excluded.cash_price,
      minimum_down_payment = excluded.minimum_down_payment, yearly_points = excluded.yearly_points;
  `);
  await client.query('commit');
  console.log('[afhomes:seed] Reference plans ready; no user or transaction rows created.');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
