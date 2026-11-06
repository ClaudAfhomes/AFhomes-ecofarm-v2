import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProductionServer,
  resolveClientIp,
  safeLogPath,
  type MaintenanceWorker,
  type ProductionServerOptions,
} from './production-server.js';

type Instance = ReturnType<typeof createProductionServer>;
const instances: Instance[] = [];

async function start(overrides: Partial<ProductionServerOptions> = {}) {
  const runtime = vi.fn(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
      }),
    );
  });
  const readiness = vi.fn(async () => {});
  const maintenance: MaintenanceWorker = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const instance = createProductionServer({
    host: '127.0.0.1',
    port: 0,
    requestTimeoutMs: 60_000,
    shutdownGraceMs: 2_000,
    maxRequestBytes: 1024,
    trustProxy: true,
    runtime,
    readiness,
    maintenance,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  });
  instances.push(instance);
  await instance.start();
  const address = instance.server.address() as AddressInfo;
  return { instance, runtime, readiness, maintenance, base: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.shutdown();
});

describe('standalone production server', () => {
  it('serves liveness without calling the database or the runtime', async () => {
    const { base, runtime, readiness } = await start();
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'afhomes-api' });
    expect(runtime).not.toHaveBeenCalled();
    expect(readiness).not.toHaveBeenCalled();
    const head = await fetch(`${base}/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('reports readiness and fails closed when the database probe fails', async () => {
    const first = await start();
    expect((await fetch(`${first.base}/ready`)).status).toBe(200);

    const second = await start({
      readiness: async () => {
        throw new Error('database unavailable');
      },
    });
    const response = await fetch(`${second.base}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready' });
  });

  it('rejects unsupported health methods with an error envelope', async () => {
    const { base } = await start();
    const response = await fetch(`${base}/health`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(await response.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } });
  });

  it('preserves the API path, method, query string, and body for the existing runtime', async () => {
    const { base, runtime } = await start();
    const body = JSON.stringify({ email: 'synthetic@example.invalid' });
    const response = await fetch(`${base}/api/v1/auth/identity/sign-in/email?mode=check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://portal.afhomes.test' },
      body,
    });
    expect(response.status).toBe(200);
    expect(runtime).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      method: 'POST',
      url: '/api/v1/auth/identity/sign-in/email?mode=check',
      body,
    });
  });

  it('rejects a declared body larger than the transport limit without invoking the runtime', async () => {
    const { base, runtime } = await start({ maxRequestBytes: 64 });
    const response = await fetch(`${base}/api/v1/customers`, {
      method: 'POST',
      body: 'x'.repeat(100),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('connection')).toBe('close');
    expect(await response.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(runtime).not.toHaveBeenCalled();
  });

  it('bounds request headers and the request timeout', async () => {
    const { instance } = await start({ requestTimeoutMs: 15_000 });
    expect(instance.server.requestTimeout).toBe(15_000);
    expect(instance.server.headersTimeout).toBe(15_000);
  });

  it('stops accepting requests and stops the maintenance worker once', async () => {
    const { instance, maintenance, base } = await start();
    expect(maintenance.start).toHaveBeenCalledOnce();
    const first = instance.shutdown();
    const second = instance.shutdown();
    await Promise.all([first, second]);
    expect(instance.server.listening).toBe(false);
    expect(maintenance.stop).toHaveBeenCalledOnce();
    await expect(fetch(`${base}/health`)).rejects.toThrow();
  });

  it('redacts password-reset tokens from request logs', () => {
    expect(safeLogPath('/api/v1/auth/identity/reset-password/abcdefghijklmnopqrstuvwx')).toBe(
      '/api/v1/auth/identity/reset-password/[redacted]',
    );
    expect(safeLogPath('/api/v1/customers/00000000-0000-0000-0000-000000000000')).toBe(
      '/api/v1/customers/00000000-0000-0000-0000-000000000000',
    );
  });

  it('trusts X-Real-IP only from a loopback peer when proxy trust is enabled', () => {
    const request = (remote: string, header?: string) =>
      ({
        socket: { remoteAddress: remote },
        headers: header ? { 'x-real-ip': header } : {},
      }) as unknown as IncomingMessage;
    expect(resolveClientIp(request('127.0.0.1', '203.0.113.5'), true)).toBe('203.0.113.5');
    expect(resolveClientIp(request('127.0.0.1', 'not-an-ip'), true)).toBe('127.0.0.1');
    expect(resolveClientIp(request('198.51.100.9', '203.0.113.5'), true)).toBe('198.51.100.9');
    expect(resolveClientIp(request('127.0.0.1', '203.0.113.5'), false)).toBe('127.0.0.1');
  });
});
