/**
 * Marketing content API contract (Phase 3: static only).
 *
 * The source site reads VIP plans and stories from `GET /api/vip/plans` and
 * `GET /api/stories[/:slug|/categories]` when `VITE_API_BASE_URL` is set.
 * This project has no marketing content API — `VITE_API_BASE_URL` belongs to
 * the staff/customer API and must never be used here — so the flag stays
 * `false` and every reader takes the static `mockRead` path, exactly as the
 * source site does when unconfigured.
 *
 * Phase 4 seam: point `BASE_URL` at the real content API when it exists.
 */

// Intentionally not `import.meta.env.VITE_API_BASE_URL`: that variable
// addresses the staff/customer API, which has no marketing content routes.
const BASE_URL = '';

export const isApiEnabled = Boolean(BASE_URL);

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!isApiEnabled) {
    throw new ApiError(
      'The AFhomes marketing content API is not configured. Static fallback content is used.',
    );
  }

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw new ApiError(`Request to ${path} failed with status ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body });
  },
};
