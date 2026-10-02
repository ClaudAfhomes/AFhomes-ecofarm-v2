import { describe, expect, it } from 'vitest';
import { mapRpcError } from './handler-kit.js';

function capture() {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.status = code;
      return { json: (body: unknown) => void (state.body = body) };
    },
  };
  return { res: res as never, state };
}

describe('mapRpcError hierarchy codes (D4)', () => {
  it('maps an incomplete seller hierarchy to 409 without internals', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'SALE_COMPLETE_HIERARCHY_REQUIRED' });
    expect(state.status).toBe(409);
    const body = state.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Complete the seller hierarchy before creating this sale.');
    expect(JSON.stringify(body)).not.toContain('SALE_COMPLETE_HIERARCHY_REQUIRED');
    expect(JSON.stringify(body)).not.toContain('23514');
  });
  it('maps an over-deep hierarchy to 409 without internals', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'SALE_HIERARCHY_TOO_DEEP' });
    expect(state.status).toBe(409);
    expect((state.body as { error: { code: string } }).error.code).toBe('CONFLICT');
  });
  it('keeps unknown failures as opaque 500s', () => {
    const { res, state } = capture();
    mapRpcError(res, { message: 'something entirely unexpected' });
    expect(state.status).toBe(500);
    expect((state.body as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});
