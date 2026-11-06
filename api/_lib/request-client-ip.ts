import { isIP } from 'node:net';

/** Nginx must overwrite X-Real-IP; only an explicit opt-in and a loopback peer can trust it. */
export function requestClientIp(
  req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  trustLoopbackProxy = false,
) {
  const peer = req.socket?.remoteAddress;
  const forwarded = req.headers['x-real-ip'];
  return trustLoopbackProxy &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') &&
    typeof forwarded === 'string' && isIP(forwarded) && !forwarded.includes('%')
    ? forwarded : peer;
}
