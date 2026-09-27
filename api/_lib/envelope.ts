/**
 * Shared error envelope for api/ handlers. Matches the @jad/contracts
 * error envelope shape ({ error: { code, message, details?, requestId,
 * timestamp } }) plus the HTTP status, so handlers can destructure
 * `{ error, status }` uniformly.
 */
export function toErrorEnvelope(code: string, message: string, status: number, details?: unknown) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    },
    status,
  };
}

export type ErrorEnvelopeResult = ReturnType<typeof toErrorEnvelope>;
