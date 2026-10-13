import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { useBusinessMutation } from './useBusinessMutation';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('coalesces a same-payload double submit into one execution', async () => {
  const mutationFn = vi.fn(async (input: { amount: string }) => `recorded:${input.amount}`);
  const onSuccess = vi.fn();
  const { result } = renderHook(
    () => useBusinessMutation({ mutationFn, onSuccess }),
    { wrapper },
  );
  result.current.mutate({ amount: '100.00' });
  result.current.mutate({ amount: '100.00' });
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(mutationFn).toHaveBeenCalledTimes(1);
  expect(onSuccess).toHaveBeenCalledWith(
    'recorded:100.00',
    { amount: '100.00' },
    undefined,
    expect.anything(),
  );
});

it('runs different payloads concurrently instead of swallowing either', async () => {
  const mutationFn = vi.fn(async (input: { id: string }) => `done:${input.id}`);
  const { result } = renderHook(() => useBusinessMutation({ mutationFn }), { wrapper });
  const first = result.current.mutateAsync({ id: 'a' });
  const second = result.current.mutateAsync({ id: 'b' });
  await expect(first).resolves.toBe('done:a');
  await expect(second).resolves.toBe('done:b');
  expect(mutationFn).toHaveBeenCalledTimes(2);
});

it('accepts the same payload again once the first execution settles', async () => {
  const mutationFn = vi.fn(async (input: { id: string }) => `done:${input.id}`);
  const { result } = renderHook(() => useBusinessMutation({ mutationFn }), { wrapper });
  await result.current.mutateAsync({ id: 'a' });
  await result.current.mutateAsync({ id: 'a' });
  expect(mutationFn).toHaveBeenCalledTimes(2);
});

it('reports failures through the standard error state', async () => {
  const failure = new Error('Insufficient permission');
  const onError = vi.fn();
  const { result } = renderHook(
    () => useBusinessMutation({ mutationFn: async () => Promise.reject<string>(failure), onError }),
    { wrapper },
  );
  result.current.mutate({});
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBe(failure);
  expect(onError).toHaveBeenCalledTimes(1);
});
