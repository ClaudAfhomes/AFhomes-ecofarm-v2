import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import { SessionProvider, type SessionUser } from '../lib/session';

/**
 * Test renderer: fresh QueryClient (no retries) + MemoryRouter + the app
 * session provider (instant restore), mirroring the providers used in
 * `main.tsx`. `initialUser` simulates a signed-in member. No API calls happen
 * until a fetch mock is set.
 */
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    routeState,
    initialUser,
  }: { route?: string; routeState?: unknown; initialUser?: SessionUser } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const initialEntry = routeState !== undefined ? { pathname: route, state: routeState } : route;
  const result = render(
    <SessionProvider initialUser={initialUser} restoreDelayMs={0}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
  return { ...result, client };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOT_FOUND_BODY = {
  error: { code: 'NOT_FOUND', message: 'Not found', timestamp: '2026-08-18T10:00:00Z' },
};

type RouteResponse = unknown | { body: unknown; status: number };

function isRouteConfig(value: RouteResponse): value is { body: unknown; status: number } {
  return typeof value === 'object' && value !== null && 'body' in value;
}

/**
 * Mock `fetch` per URL path suffix. Any unmatched URL returns a 404 error
 * envelope. Matching is against the URL pathname (query strings are stripped)
 * because the client prefixes `VITE_API_BASE_URL` (default `/api/v1`) and may
 * append query params (cursor pagination, filters). Routes may be a plain body
 * (200) or `{ body, status }` to simulate API errors.
 */
export function mockFetchRoutes(routes: Record<string, RouteResponse>): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const pathOnly = new URL(String(input), 'http://mock.local').pathname;
    for (const [path, cfg] of Object.entries(routes)) {
      if (pathOnly.endsWith(path)) {
        const { body, status } = isRouteConfig(cfg) ? cfg : { body: cfg, status: 200 };
        return Promise.resolve(jsonResponse(body, status));
      }
    }
    return Promise.resolve(jsonResponse(NOT_FOUND_BODY, 404));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Mock `fetch` to always resolve with a given body (useful for single-endpoint tests). */
export function mockFetchJson(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Mock `fetch` to reject like a network failure. */
export function mockFetchNetworkError(): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fn);
  return fn;
}
