import { cookieAuthSessionSchema, cookieAuthSignInSchema } from '@afhomes/contracts';
import { withRequestDeadline } from './request-deadline.js';

const eventName = 'afhomes-cookie-auth-change';
export class CookieAuthError extends Error {
  constructor(readonly reason: 'unavailable' | 'rate_limited' | 'rejected') {
    super(
      reason === 'unavailable'
        ? 'The sign-in service is unavailable. Please try again shortly.'
        : reason === 'rate_limited'
          ? 'Too many sign-in attempts. Please wait before trying again.'
          : 'Authentication request failed. Please try again.',
    );
  }
}
export function pendingCookieMfa() {
  return (
    typeof sessionStorage !== 'undefined' &&
    Date.now() - Number(sessionStorage.getItem('afhomes-mfa-pending') ?? 0) < 5 * 60_000
  );
}
export function notifyCookieAuth() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName));
}
export function subscribeCookieAuth(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener('focus', callback);
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('afhomes-cookie-auth') : null;
  channel?.addEventListener('message', callback);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('focus', callback);
    channel?.close();
  };
}
function publish() {
  notifyCookieAuth();
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel('afhomes-cookie-auth');
    channel.postMessage('changed');
    channel.close();
  }
}
export function createCookieAuthGateway(apiBase: string) {
  async function request(path: string, body?: unknown) {
    try {
      return await withRequestDeadline(async (signal) => {
        const response = await fetch(`${apiBase}/auth/identity${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal,
        });
        if (response.status === 429) throw new CookieAuthError('rate_limited');
        if (response.status >= 500) throw new CookieAuthError('unavailable');
        if (!response.ok) throw new CookieAuthError('rejected');
        return await response.json();
      });
    } catch (error) {
      if (error instanceof CookieAuthError) throw error;
      throw new CookieAuthError('unavailable');
    }
  }
  return {
    request,
    async read() {
      return cookieAuthSessionSchema.parse(await request('/get-session', {}));
    },
    async signIn(email: string, password: string) {
      const parsed = cookieAuthSignInSchema.safeParse(
        await request('/sign-in/email', { email, password }),
      );
      if (!parsed.success) throw new CookieAuthError('unavailable');
      const result = parsed.data;
      if (typeof sessionStorage !== 'undefined') {
        if (result.twoFactorRedirect)
          sessionStorage.setItem('afhomes-mfa-pending', String(Date.now()));
        else sessionStorage.removeItem('afhomes-mfa-pending');
      }
      publish();
      return result;
    },
    async signOut() {
      await request('/sign-out', {});
      sessionStorage.removeItem('afhomes-mfa-pending');
      publish();
    },
    completeMfa() {
      sessionStorage.removeItem('afhomes-mfa-pending');
      publish();
    },
  };
}
