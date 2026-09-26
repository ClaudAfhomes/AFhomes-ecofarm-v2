import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { usePolicyLinks } from './usePolicyLinks';
import { mockFetchNetworkError, mockFetchRoutes } from '../test/utils';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('usePolicyLinks', () => {
  it('links only policies that exist in the API response (by slug)', async () => {
    mockFetchRoutes({
      '/policies': {
        data: [
          {
            id: 'pol-mtw',
            slug: 'terms',
            title: 'Terms',
            type: 'terms',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
        meta: {},
      },
    });
    const { result } = renderHook(() => usePolicyLinks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.privacy).toBeUndefined());
    expect(result.current.terms).toBe('/policies/terms');
    expect(result.current.guidelines).toBeUndefined();
  });

  it('falls back to the seeded links when the API is unreachable (Q6)', async () => {
    mockFetchNetworkError();
    const { result } = renderHook(() => usePolicyLinks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.terms).toBe('/policies/terms'));
    expect(result.current.privacy).toBe('/policies/privacy');
    expect(result.current.guidelines).toBe('/policies/guidelines');
  });
});
