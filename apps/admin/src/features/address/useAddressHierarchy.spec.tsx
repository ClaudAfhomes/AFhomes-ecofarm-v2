import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createTestQueryClient } from '../../test/utils.js';
import * as services from './services.js';
import { useBarangaysQuery, useLocalitiesQuery, useProvincesQuery } from './useAddressHierarchy.js';

vi.mock('./services.js', async (original) => ({ ...(await original()) }));

const LAGUNA = { code: '0403400000', name: 'Laguna' };
const BATANGAS = { code: '0406100000', name: 'Batangas' };
const CALAUAN = {
  code: '0403406000',
  name: 'Calauan',
  type: 'municipality' as const,
  provinceCode: '0403400000',
};
const LEMERY = {
  code: '0406110000',
  name: 'Lemery',
  type: 'municipality' as const,
  provinceCode: '0406100000',
};
const DAYAP = { code: '0403406003', name: 'Dayap', localityCode: '0403406000' };

let getProvinces: ReturnType<typeof vi.fn>;
let getLocalities: ReturnType<typeof vi.fn>;
let getBarangays: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getProvinces = vi.fn(async () => [LAGUNA, BATANGAS]);
  getLocalities = vi.fn(async (code: string) => (code === LAGUNA.code ? [CALAUAN] : [LEMERY]));
  getBarangays = vi.fn(async (code: string) => (code === CALAUAN.code ? [DAYAP] : []));
  vi.spyOn(services, 'getAddressProvinces').mockImplementation(getProvinces as never);
  vi.spyOn(services, 'getAddressLocalities').mockImplementation(getLocalities as never);
  vi.spyOn(services, 'getAddressBarangays').mockImplementation(getBarangays as never);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
);

describe('useProvincesQuery', () => {
  it('loads the province list through the AF Homes API', async () => {
    const { result } = renderHook(() => useProvincesQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([LAGUNA, BATANGAS]));
    expect(getProvinces).toHaveBeenCalledTimes(1);
  });

  it('serves a second reader from cache rather than asking again', async () => {
    const client = createTestQueryClient();
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => useProvincesQuery(), { wrapper: wrap });
    await waitFor(() => expect(getProvinces).toHaveBeenCalledTimes(1));
    renderHook(() => useProvincesQuery(), { wrapper: wrap });

    // Reference data, not an operational list: one session, one fetch.
    expect(getProvinces).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load failure instead of an empty list', async () => {
    getProvinces.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useProvincesQuery(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useLocalitiesQuery', () => {
  it('asks for the localities of the selected province', async () => {
    const { result } = renderHook(() => useLocalitiesQuery(LAGUNA.code), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([CALAUAN]));
    expect(getLocalities).toHaveBeenCalledWith(LAGUNA.code);
  });

  it('makes no request at all until a province is chosen', async () => {
    renderHook(() => useLocalitiesQuery(undefined), { wrapper });

    expect(getLocalities).not.toHaveBeenCalled();
  });

  it('re-keys on the province, so the previous province is never shown', async () => {
    const { result, rerender } = renderHook(({ code }: { code: string | undefined }) =>
      useLocalitiesQuery(code), { wrapper, initialProps: { code: LAGUNA.code as string | undefined } });

    await waitFor(() => expect(result.current.data).toEqual([CALAUAN]));
    rerender({ code: BATANGAS.code });
    await waitFor(() => expect(result.current.data).toEqual([LEMERY]));
  });

  it('cannot let a slow earlier province overwrite a newer selection', async () => {
    // Batangas resolves first, Laguna second and late. The visible options must
    // still be Batangas's - a stale response must never win.
    getLocalities.mockImplementation(async (code: string) => {
      if (code === LAGUNA.code) {
        await new Promise((r) => setTimeout(r, 60));
        return [CALAUAN];
      }
      return [LEMERY];
    });

    const { result, rerender } = renderHook(({ code }: { code: string }) =>
      useLocalitiesQuery(code), { wrapper, initialProps: { code: BATANGAS.code } });

    await waitFor(() => expect(result.current.data).toEqual([LEMERY]));
    rerender({ code: LAGUNA.code });
    rerender({ code: BATANGAS.code });

    await new Promise((r) => setTimeout(r, 120));
    expect(result.current.data).toEqual([LEMERY]);
  });

  it('does not retry a lookup that legitimately 404s', async () => {
    getLocalities.mockRejectedValue(new Error('No such location'));
    const { result } = renderHook(() => useLocalitiesQuery('9999999999'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getLocalities).toHaveBeenCalledTimes(1);
  });
});

describe('useBarangaysQuery', () => {
  it('asks for the barangays of the selected locality', async () => {
    const { result } = renderHook(() => useBarangaysQuery(CALAUAN.code), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([DAYAP]));
    expect(getBarangays).toHaveBeenCalledWith(CALAUAN.code);
  });

  it('makes no request at all until a locality is chosen', async () => {
    renderHook(() => useBarangaysQuery(undefined), { wrapper });

    expect(getBarangays).not.toHaveBeenCalled();
  });

  it('re-keys on the locality, so the previous locality is never shown', async () => {
    const { result, rerender } = renderHook(({ code }: { code: string }) => useBarangaysQuery(code), {
      wrapper,
      initialProps: { code: CALAUAN.code },
    });

    await waitFor(() => expect(result.current.data).toEqual([DAYAP]));
    rerender({ code: LEMERY.code });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});