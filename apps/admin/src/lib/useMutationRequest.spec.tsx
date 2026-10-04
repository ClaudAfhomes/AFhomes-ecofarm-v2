import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMutationRequest } from './useMutationRequest';

describe('logical mutation request identity', () => {
  it('retains the UUID across a rerender and a timeout retry', () => {
    const hook = renderHook(() => useMutationRequest());
    const first = hook.result.current.forPayload({ amount: '100.00', sale: 'one' });
    hook.rerender();
    expect(hook.result.current.forPayload({ sale: 'one', amount: '100.00' })).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('gives changed intent a new UUID', () => {
    const hook = renderHook(() => useMutationRequest());
    const first = hook.result.current.forPayload({ amount: '100.00' });
    expect(hook.result.current.forPayload({ amount: '200.00' })).not.toBe(first);
  });
  it('allows a separate identical action after successful completion', () => {
    const hook = renderHook(() => useMutationRequest());
    const first = hook.result.current.forPayload({ amount: '100.00' });
    hook.result.current.complete();
    expect(hook.result.current.forPayload({ amount: '100.00' })).not.toBe(first);
  });
});
