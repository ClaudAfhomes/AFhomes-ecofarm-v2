import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { emptyOstAddress } from '@afhomes/ui';
import { protectedRequestList } from '../../lib/api/client';
import { useOstAddress } from './useOstAddress';

vi.mock('../../lib/api/client', () => ({
  protectedRequestList: vi.fn().mockResolvedValue([{ code: '0403400000', name: 'Laguna' }]),
}));

it('loads provinces through the same root address endpoint as IST without requesting regions', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result, unmount } = renderHook(() => useOstAddress(emptyOstAddress(), false), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.provinces.isSuccess).toBe(true));
  expect(protectedRequestList).toHaveBeenCalledWith('/address', expect.anything());
  expect(protectedRequestList).not.toHaveBeenCalledWith('/address/provinces', expect.anything());
  expect(protectedRequestList).not.toHaveBeenCalledWith('/address/regions', expect.anything());
  unmount();
  client.clear();
});
