import type { ApiErrorCode } from '@jad/contracts';

/**
 * Normalized API error mapped from the API error envelope
 * (API-SPECIFICATION.md §3). Carries the stable code, the server message, and
 * the correlation `requestId` (DEVELOPMENT-GUIDELINES §10).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(options: {
    code: ApiErrorCode | string;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

/**
 * The server responded, but the payload did not match the contract schema.
 * Surfaces as a generic, recoverable error state (UI-UX §10 "Error") - the
 * client never silently coerces mismatched data.
 */
export class ApiParseError extends Error {
  constructor(path: string, message: string) {
    super(`Response for ${path} did not match the contract schema: ${message}`);
    this.name = 'ApiParseError';
  }
}

/**
 * A network-level failure (offline, DNS, timeout, connection refused).
 * Maps to the UI-UX §10 "Network failure" state.
 */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('Network failure while reaching the API');
    this.name = 'ApiNetworkError';
    this.cause = cause;
  }
}

const DEFAULT_STATUS = 500;
const DEFAULT_CODE = 'INTERNAL';

/** Build an ApiError from an unknown body (falls back to the generic envelope). */
export function toApiError(body: unknown, status: number): ApiError {
  if (typeof body === 'object' && body !== null) {
    const err = (
      body as {
        error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown };
      }
    ).error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      return new ApiError({
        code: err.code,
        message: err.message,
        status,
        requestId: typeof err.requestId === 'string' ? err.requestId : undefined,
        details: err.details,
      });
    }
  }
  return new ApiError({
    code: DEFAULT_CODE,
    message: 'An unexpected error occurred.',
    status: DEFAULT_STATUS,
  });
}
