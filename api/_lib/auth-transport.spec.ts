import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthNodeHandler } from './auth-transport.js';
import { makeRes } from './testing/supabase-fake.js';

const servers: http.Server[] = [];
async function serve(handler: (request: Request) => Promise<Response>) {
  const server = http.createServer(createAuthNodeHandler(handler, 'http://localhost:3000'));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}/api/v1/auth/identity`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe('unmounted raw auth transport', () => {
  it('preserves independent cookies, including a comma inside Expires', async () => {
    const cookies = [
      'one=value; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      'two=value; Path=/; HttpOnly',
    ];
    const url = await serve(async () => {
      const headers = new Headers();
      for (const cookie of cookies) headers.append('Set-Cookie', cookie);
      return new Response('{}', { headers });
    });
    const response = await fetch(url + '/get-session');
    expect(response.headers.getSetCookie()).toEqual(cookies);
    const fake = makeRes();
    fake.res.setHeader('Set-Cookie', cookies);
    expect(fake.state.headers['set-cookie']).toEqual(cookies);
  });

  it('passes the original body bytes without JSON parsing and ignores forwarded host headers', async () => {
    const raw = '{ "email" : "synthetic@example.invalid" }';
    const url = await serve(async (request) =>
      Response.json({ body: await request.text(), url: request.url }),
    );
    const response = await fetch(url + '/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'untrusted.invalid',
        'X-Forwarded-Proto': 'https',
      },
      body: raw,
    });
    expect(await response.json()).toEqual({
      body: raw,
      url: 'http://localhost:3000/api/v1/auth/identity/sign-in/email',
    });
  });

  it('blocks signup, admin, unsupported methods and encoded path variants before dispatch', async () => {
    const handler = vi.fn(async () => new Response('{}'));
    const url = await serve(handler);
    for (const path of [
      '/sign-up/email',
      '/admin/create-user',
      '/admin/set-role',
      '/%61dmin/create-user',
      '/sign-in/email/extra',
      '/two-factor/enable',
      '/two-factor/verify-totp',
    ]) {
      expect((await fetch(url + path, { method: 'POST' })).status).toBe(404);
    }
    expect((await fetch(url + '/sign-out', { method: 'GET' })).status).toBe(404);
    expect((await fetch(url + '/get-session', { method: 'DELETE' })).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an oversized request without dispatch', async () => {
    const handler = vi.fn(async () => new Response('{}'));
    const url = await serve(handler);
    const response = await fetch(url + '/sign-in/email', {
      method: 'POST',
      body: 'x'.repeat(65_537),
    });
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a static failure without disclosing an exception', async () => {
    const url = await serve(async () => {
      throw new Error('private connection details');
    });
    const response = await fetch(url + '/get-session');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private connection details');
  });

  it('bounds a chunked body even without Content-Length', async () => {
    const consumed = vi.fn();
    const url = await serve(async (request) => {
      const body = await request.text();
      consumed(body);
      return new Response('{}');
    });
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        url + '/sign-in/email',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on('error', reject);
      request.write('x'.repeat(40_000));
      request.end('x'.repeat(40_000));
    });
    expect(status).toBe(413);
    expect(consumed).not.toHaveBeenCalled();
  });
});
