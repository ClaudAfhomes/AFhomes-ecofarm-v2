import { afterEach, describe, expect, it, vi } from 'vitest';
import { getValidatedWebLoginUrl } from './RequireRole';

/**
 * The admin guard is UX only - the server is the security boundary - but a
 * misconfigured guard is still an operational defect, because an
 * unauthenticated operator gets a silent dead end instead of an error.
 *
 * These cases pin the rule that the `localhost:5173` fallback is a DEVELOPMENT
 * convenience only. In a production build an absent, blank or malformed
 * `VITE_WEB_URL` must resolve to `null` so the caller can report a configuration
 * error, rather than navigating the operator's browser to a host that does not
 * exist and leaving them on an eternal spinner.
 *
 * `import.meta.env.DEV` is true under vitest by default, so every production case
 * stubs it off explicitly. Getting that wrong is exactly the kind of "a test
 * that cannot fail" this suite exists to prevent: without the stub these cases
 * would pass against the localhost fallback while proving nothing.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

const asProduction = () => vi.stubEnv('DEV', false);

describe('getValidatedWebLoginUrl', () => {
  it('returns null rather than a localhost URL when VITE_WEB_URL is absent', () => {
    asProduction();
    vi.stubEnv('VITE_WEB_URL', '');
    expect(getValidatedWebLoginUrl()).toBeNull();
  });

  it('returns null rather than a localhost URL when VITE_WEB_URL is whitespace', () => {
    // A whitespace-only value is the realistic operator mistake: the variable
    // "exists" in the dashboard but carries nothing usable.
    asProduction();
    vi.stubEnv('VITE_WEB_URL', '   ');
    expect(getValidatedWebLoginUrl()).toBeNull();
  });

  it('returns null for a non-http(s) scheme instead of navigating to it', () => {
    // `javascript:` here would be an XSS sink if it were ever assigned to
    // window.location.href, so the protocol allow-list must reject it outright
    // rather than falling back to a default.
    asProduction();
    vi.stubEnv('VITE_WEB_URL', 'javascript:alert(1)');
    expect(getValidatedWebLoginUrl()).toBeNull();
  });

  it('rejects a malformed URL instead of falling back', () => {
    asProduction();
    vi.stubEnv('VITE_WEB_URL', 'not a url');
    expect(getValidatedWebLoginUrl()).toBeNull();
  });

  it('builds the /login path from the configured origin', () => {
    asProduction();
    vi.stubEnv('VITE_WEB_URL', 'https://afhomes.example');
    expect(getValidatedWebLoginUrl()).toBe('https://afhomes.example/login');
  });

  it('does not double up /login when the configured value already ends in it', () => {
    asProduction();
    vi.stubEnv('VITE_WEB_URL', 'https://afhomes.example/login');
    expect(getValidatedWebLoginUrl()).toBe('https://afhomes.example/login');
  });

  it('tolerates a trailing slash on the configured origin', () => {
    asProduction();
    vi.stubEnv('VITE_WEB_URL', 'https://afhomes.example/');
    expect(getValidatedWebLoginUrl()).toBe('https://afhomes.example/login');
  });

  it('keeps the localhost fallback in a development build', () => {
    // The dev convenience is deliberate and must survive: running `pnpm dev`
    // with no VITE_WEB_URL set should still land on the local sign-in page.
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_WEB_URL', '');
    expect(getValidatedWebLoginUrl()).toBe('http://localhost:5173/login');
  });
});
