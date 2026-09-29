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
    insert into public.card_plans (category_id, code, name, cash_price, minimum_down_payment, yearly_points,
      installment_price, reservation_fee, spot_cash_days, standard_installment_months, validity_years,
      move_a_enabled, move_b1_enabled, move_b2_enabled)
    select c.id, v.code, v.name, v.cash_price, v.minimum_down_payment, v.yearly_points,
      v.installment_price, v.reservation_fee, v.spot_cash_days, v.standard_installment_months, v.validity_years,
      v.move_a_enabled, v.move_b1_enabled, v.move_b2_enabled
    from public.card_categories c
    cross join (values
      ('GOLD','Gold','312000.00','20000.00',60000,'390000.00','10000.00',7,4,22,true,true,true),
      ('SILVER','Silver','192000.00','15000.00',40000,'240000.00','10000.00',7,4,12,true,true,true),
      ('BRONZE','Bronze','54000.00','10000.00',25000,'72000.00','10000.00',7,4,7,true,false,false)
    ) v(code,name,cash_price,minimum_down_payment,yearly_points,installment_price,reservation_fee,spot_cash_days,standard_installment_months,validity_years,move_a_enabled,move_b1_enabled,move_b2_enabled)
    where c.slug = 'membership'
    on conflict (code) do update set name = excluded.name, cash_price = excluded.cash_price,
      minimum_down_payment = excluded.minimum_down_payment, yearly_points = excluded.yearly_points,
      installment_price = excluded.installment_price, reservation_fee = excluded.reservation_fee,
      spot_cash_days = excluded.spot_cash_days,
      standard_installment_months = excluded.standard_installment_months,
      validity_years = excluded.validity_years, move_a_enabled = excluded.move_a_enabled,
      move_b1_enabled = excluded.move_b1_enabled, move_b2_enabled = excluded.move_b2_enabled;
  `);
  await client.query('commit');
  console.log('[afhomes:seed] Reference plans ready; no user or transaction rows created.');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
