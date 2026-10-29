import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequest, setResponse } from 'better-call/node';
import { toErrorEnvelope } from './envelope.js';

const BASE_PATH = '/api/v1/auth/identity';
const METHODS: Record<string, readonly string[]> = {
  '/get-session': ['GET', 'POST'],
  '/sign-in/email': ['POST'],
  '/sign-out': ['POST'],
  '/send-verification-email': ['POST'],
  '/verify-email': ['GET'],
  '/request-password-reset': ['POST'],
  '/reset-password': ['POST'],
};
const BODY_LIMIT = 65_536;

/** Unmounted raw Node transport. Never pass a provisioning/admin handler here. */
export function createAuthNodeHandler(
  handler: (request: Request) => Promise<Response>,
  baseURL: string,
) {
  const origin = new URL(baseURL).origin;
  return async (req: IncomingMessage, res: ServerResponse) => {
    // Only the actual socket peer is trusted here; client IP headers are overwritten.
    req.headers['x-real-ip'] = req.socket.remoteAddress ?? '127.0.0.1';
    const fail = (status: number, message: string) => {
      req.resume();
      const { error } = toErrorEnvelope(status === 404 ? 'NOT_FOUND' : 'INTERNAL', message, status);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error }));
    };
    try {
      const pathname = new URL(req.url ?? '/', origin).pathname;
      const relative = pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : '';
      const resetLink =
        /^\/reset-password\/[A-Za-z0-9_-]{20,256}$/.test(relative) && req.method === 'GET';
      if (!resetLink && !METHODS[relative]?.includes(req.method ?? 'GET'))
        return fail(404, 'Authentication endpoint not found');
      if (Number(req.headers['content-length']) > BODY_LIMIT)
        return fail(413, 'Authentication request is too large');
      // Use the same adapter as Better Auth's Node wrapper, with a bounded raw body.
      const request = getRequest({ request: req, base: origin, bodySizeLimit: BODY_LIMIT });
      const response = await handler(request);
      response.headers.set('Cache-Control', 'no-store');
      await setResponse(res, response);
    } catch (error) {
      if (res.destroyed) return;
      const tooLarge =
        error instanceof Error && error.message.startsWith('request body size exceeded ');
      if (!res.headersSent)
        fail(
          tooLarge ? 413 : 503,
          tooLarge ? 'Authentication request is too large' : 'Authentication is unavailable',
        );
      else res.destroy();
    }
  };
}
