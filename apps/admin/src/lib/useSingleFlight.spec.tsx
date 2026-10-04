import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSingleFlight } from './useSingleFlight';
it('coalesces clicks before React rerenders and permits a later corrected retry', async () => {
  const { result } = renderHook(() => useSingleFlight<number>());
  const operation = vi.fn(async () => 7);
  const first = result.current(operation);
  const duplicate = result.current(operation);
  expect(first).toBe(duplicate);
  expect(await first).toBe(7);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(await result.current(operation)).toBe(7);
  expect(operation).toHaveBeenCalledTimes(2);
});
