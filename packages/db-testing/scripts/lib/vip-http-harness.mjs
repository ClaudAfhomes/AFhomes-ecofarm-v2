import assert from 'node:assert/strict';
import http from 'node:http';
import { FakeSupabase } from '../../../../api/_lib/testing/supabase-fake.ts';

// Test-only Auth/PostgREST doubles; queries and financial RPCs use disposable PostgreSQL.
export async function startVipHttpHarness(db, identities) {
  const tables = (
    await db.query("select tablename from pg_tables where schemaname='public'")
  ).rows.map((r) => r.tablename);
  const links = (
    await db.query(`select tc.table_name child,ccu.table_name parent,kcu.column_name fk,ccu.column_name pk
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.constraint_schema=tc.constraint_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema
    where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' and ccu.table_schema='public'`)
  ).rows;
  const send = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  const body = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  };
  const provider = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/auth/v1/user') {
        const id = identities.get(req.headers.authorization?.replace(/^Bearer /, ''));
        return send(
          res,
          id ? 200 : 401,
          id
            ? {
                id,
                email: 'synthetic@example.invalid',
                email_confirmed_at: new Date().toISOString(),
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: {},
                user_metadata: {},
              }
            : { message: 'Invalid test session' },
        );
      }
      assert.equal(req.headers.apikey, 'vip-local-service');
      const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      if (rpc && req.method === 'POST') {
        const args = await body(req);
        const metadata = (
          await db.query(
            `select p.proretset,t.typtype,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and p.proname=$1`,
            [rpc[1]],
          )
        ).rows;
        assert.equal(metadata.length, 1, 'RPC must resolve unambiguously');
        const names = Object.keys(args);
        for (const name of names)
          assert.ok(/^[a-z_]+$/.test(name) && metadata[0].proargnames.includes(name));
        await db.query('savepoint http_rpc');
        try {
          const rows = (
            await db.query(
              `select * from public.${rpc[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')})`,
              names.map((n) =>
                typeof args[n] === 'object' && args[n] !== null ? JSON.stringify(args[n]) : args[n],
              ),
            )
          ).rows;
          await db.query('release savepoint http_rpc');
          return send(res, 200, metadata[0].proretset ? rows : (rows[0]?.[rpc[1]] ?? rows[0]));
        } catch (error) {
          await db.query('rollback to savepoint http_rpc');
          await db.query('release savepoint http_rpc');
          return send(res, 400, { code: error.code, message: error.message });
        }
      }
      const name = url.pathname.replace('/rest/v1/', '');
      assert.ok(tables.includes(name), 'Only fixture tables may be queried');
      if (req.method === 'POST') {
        assert.ok(
          [
            'audit_events',
            'service_tier_discounts',
            'point_earning_rules',
            'point_redemption_rules',
          ].includes(name),
          'Only explicit fixture configuration/audit writes',
        );
        const input = await body(req);
        const rows = Array.isArray(input) ? input : [input];
        const written = [];
        await db.query('savepoint http_insert');
        try {
          for (const row of rows) {
            const columns = Object.keys(row);
            for (const column of columns) assert.ok(/^[a-z_]+$/.test(column));
            const result = await db.query(
              'insert into public."' +
                name +
                '" (' +
                columns.join(',') +
                ') values (' +
                columns.map((_, i) => '$' + (i + 1)).join(',') +
                ') returning *',
              columns.map((column) => row[column]),
            );
            written.push(...result.rows);
          }
          await db.query('release savepoint http_insert');
          return send(
            res,
            201,
            req.headers.accept?.includes('application/vnd.pgrst.object') ? written[0] : written,
          );
        } catch (error) {
          await db.query('rollback to savepoint http_insert');
          await db.query('release savepoint http_insert');
          return send(res, 400, { code: error.code, message: error.message });
        }
      }
      assert.equal(req.method, 'GET', 'Unsupported fixture HTTP operation');
      const snapshot = {};
      for (const table of tables)
        snapshot[table] = JSON.parse(
          JSON.stringify((await db.query(`select * from public."${table}"`)).rows),
        );
      const fake = new FakeSupabase({ tables: snapshot, links });
      let query = fake.from(name).select(url.searchParams.get('select') ?? '*');
      for (const [key, value] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        const dot = value.indexOf('.');
        const op = value.slice(0, dot);
        const raw = value.slice(dot + 1);
        if (op === 'eq' || op === 'neq' || op === 'lte' || op === 'gte')
          query = query[op](key, raw === 'true' ? true : raw === 'false' ? false : raw);
        else if (op === 'in') query = query.in(key, raw.slice(1, -1).split(','));
        else if (op === 'is') query = query.is(key, raw === 'null' ? null : raw === 'true');
        else throw new Error('Unsupported fixture filter ' + op);
      }
      for (const order of (url.searchParams.get('order') ?? '').split(',').filter(Boolean)) {
        const [col, direction] = order.split('.');
        query = query.order(col, { ascending: direction !== 'desc' });
      }
      if (url.searchParams.has('limit')) query = query.limit(Number(url.searchParams.get('limit')));
      if (req.headers.accept?.includes('application/vnd.pgrst.object')) query = query.maybeSingle();
      const result = await query;
      if (result.error) return send(res, 400, result.error);
      return send(res, 200, result.data);
    } catch (error) {
      send(res, 500, { message: error.message });
    }
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const previous = {};
  for (const [key, value] of Object.entries({
    SUPABASE_URL: `http://127.0.0.1:${provider.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: 'vip-local-service',
    SUPABASE_PUBLISHABLE_KEY: 'vip-local-anon',
    DATABASE_URL: ' ',
  })) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  const { routeRequest } = await import('../../../../api/_lib/router.ts');
  const api = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let status = 200;
      const response = {
        setHeader: (k, v) => res.setHeader(k, v),
        status: (code) => {
          status = code;
          return response;
        },
        json: (value) => send(res, status, value),
        end: () => res.end(),
      };
      const matched = await routeRequest(
        {
          url: req.url,
          method: req.method,
          headers: req.headers,
          query: Object.fromEntries(url.searchParams),
          body: await body(req),
        },
        response,
      );
      if (!matched) send(res, 404, { error: { message: 'Route not found' } });
    } catch (error) {
      send(res, 500, { error: { message: error.message } });
    }
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${api.address().port}/api/v1`;
  return {
    async request(path, token, payload, expected = 200) {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(10000),
        method: payload === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: 'Bearer ' + token } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const value = await response.json();
      assert.equal(response.status, expected, path + ': ' + JSON.stringify(value));
      return value;
    },
    async stop() {
      await Promise.all([
        new Promise((resolve) => api.close(resolve)),
        new Promise((resolve) => provider.close(resolve)),
      ]);
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
