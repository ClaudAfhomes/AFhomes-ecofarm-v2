import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { toErrorEnvelope } from './envelope.js';

export type RuntimeHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export type MaintenanceWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export type ProductionServerOptions = {
  host: string;
  port: number;
  requestTimeoutMs: number;
  shutdownGraceMs: number;
  maxRequestBytes: number;
  trustProxy: boolean;
  runtime: RuntimeHandler;
  readiness: () => Promise<void>;
  maintenance?: MaintenanceWorker;
  logger?: Logger;
  /** Readiness probe budget; the deployment proxy uses a 60s read timeout. */
  readinessTimeoutMs?: number;
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}

/**
 * The client address used for authentication rate limiting and audit.
 *
 * Forwarded headers are ignored unless `AFHOMES_TRUST_PROXY=true` and the
 * socket peer is itself loopback, i.e. the request came from the local Nginx.
 * Nginx must overwrite `X-Real-IP` (the documented configuration does).
 */
export function resolveClientIp(req: IncomingMessage, trustProxy: boolean): string {
  const peer = req.socket.remoteAddress ?? '';
  if (trustProxy && isLoopback(peer)) {
    const header = req.headers['x-real-ip'];
    const candidate = Array.isArray(header) ? header[0] : header;
    if (candidate && isIP(candidate.trim())) return candidate.trim();
  }
  return peer || '127.0.0.1';
}

export function safeLogPath(pathname: string): string {
  // Password-reset links carry a single-use credential in the path.
  return pathname.replace(
    /^(\/api\/v1\/auth\/identity\/reset-password\/)[^/]+$/,
    '$1[redacted]',
  );
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  method: string | undefined,
): void {
  if (res.headersSent || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(method === 'HEAD' ? undefined : payload);
}

async function bounded(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('readiness timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Standalone HTTP adapter for the approved MongoDB runtime.
 *
 * It owns only transport concerns: bounded bodies, health/readiness, safe
 * logging, proxy trust, timeouts, and orderly shutdown. Business routing and
 * authorization stay in `createMongoPhase5Runtime`.
 */
export function createProductionServer(options: ProductionServerOptions) {
  const logger = options.logger ?? console;
  let started = false;
  let stopping: Promise<{ forced: boolean }> | null = null;
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint();
    const method = req.method ?? 'GET';
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(
        res,
        400,
        { error: toErrorEnvelope('VALIDATION_ERROR', 'Invalid request URL', 400).error },
        method,
      );
      return;
    }

    requestCount += 1;
    res.once('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      // Path only: never query strings, cookies, headers, or bodies. Reset
      // tokens are redacted before they can reach the journal.
      logger.info(`[api] ${method} ${safeLogPath(pathname)} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });

    if (pathname === '/health' || pathname === '/ready') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        sendJson(
          res,
          405,
          { error: toErrorEnvelope('METHOD_NOT_ALLOWED', 'Method not allowed', 405).error },
          method,
        );
        return;
      }
      if (pathname === '/health') {
        sendJson(
          res,
          200,
          {
            status: 'ok',
            service: 'afhomes-api',
            uptimeSeconds: Math.floor(process.uptime()),
          },
          method,
        );
        return;
      }
      void bounded(options.readiness, options.readinessTimeoutMs ?? 2_500).then((ready) =>
        sendJson(
          res,
          ready ? 200 : 503,
          ready ? { status: 'ready' } : { status: 'not_ready' },
          method,
        ),
      );
      return;
    }

    const declared = req.headers['content-length'];
    const declaredBytes = typeof declared === 'string' ? Number(declared) : undefined;
    if (
      declaredBytes !== undefined &&
      Number.isFinite(declaredBytes) &&
      declaredBytes > options.maxRequestBytes
    ) {
      res.setHeader('Connection', 'close');
      sendJson(
        res,
        413,
        { error: toErrorEnvelope('PAYLOAD_TOO_LARGE', 'Request body is too large', 413).error },
        method,
      );
      return;
    }

    void Promise.resolve()
      .then(() => options.runtime(req, res))
      .catch(() => {
        if (!res.headersSent) {
          sendJson(
            res,
            503,
            { error: toErrorEnvelope('INTERNAL', 'Service is unavailable', 503).error },
            method,
          );
        } else res.destroy();
      });
  });

  server.requestTimeout = options.requestTimeoutMs;
  server.headersTimeout = Math.min(20_000, options.requestTimeoutMs);
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  server.on('clientError', (error, socket) => {
    if (!socket.writable || (error as NodeJS.ErrnoException).code === 'ECONNRESET') {
      socket.destroy();
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return {
    server,
    get requestCount() {
      return requestCount;
    },
    async start(): Promise<void> {
      if (started) throw new Error('Server has already started');
      if (stopping) throw new Error('Server is shutting down');
      await options.maintenance?.start();
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            server.off('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            server.off('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(options.port, options.host);
        });
        started = true;
      } catch (error) {
        await options.maintenance?.stop().catch(() => {});
        throw error;
      }
    },
    async shutdown(): Promise<{ forced: boolean }> {
      if (stopping) return stopping;
      stopping = (async () => {
        let forced = false;
        const close = started
          ? new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeIdleConnections();
            })
          : Promise.resolve();
        const grace = new Promise<'timeout'>((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), options.shutdownGraceMs);
          timer.unref();
        });
        const result = await Promise.race([close.then(() => 'closed' as const), grace]);
        if (result === 'timeout') {
          forced = true;
          logger.warn('[api] shutdown grace expired; closing remaining connections');
          server.closeAllConnections();
          await close;
        }
        await options.maintenance?.stop().catch(() => {
          logger.warn('[api] maintenance worker did not stop cleanly');
        });
        return { forced };
      })();
      return stopping;
    },
  };
}
