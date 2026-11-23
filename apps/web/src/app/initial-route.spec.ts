import { expect, it, vi } from 'vitest';

const started = vi.hoisted(() => new Set<string>());
const preload = vi.hoisted(() => vi.fn());
vi.mock('react-dom', () => ({ preload }));
const gate = vi.hoisted(() => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
});
vi.mock('../marketing/MarketingLayout', async () => {
  started.add('layout');
  await gate.promise;
  return {};
});
vi.mock('../features/customer/HomeLoginPage', async () => {
  started.add('home');
  await gate.promise;
  return {};
});
vi.mock('../features/ost/OstLoginPage', () => {
  throw new Error('chunk unavailable');
});

import { preloadInitialRoute } from './initial-route';

it('overlaps the homepage and shell downloads instead of waiting for an Outlet render', async () => {
  const pending = preloadInitialRoute('/');
  try {
    await vi.waitFor(() => expect([...started].sort()).toEqual(['home', 'layout']));
  } finally {
    gate.release();
  }
  expect((await pending).every((result) => result.status === 'fulfilled')).toBe(true);
  expect(preload).toHaveBeenCalledWith(expect.any(String), { as: 'image', fetchPriority: 'high' });
});

it('does not block startup when a speculative route download fails', async () => {
  expect(await preloadInitialRoute('/ost/login')).toMatchObject([{ status: 'rejected' }]);
});

it('does not download unrelated routes for an unknown URL', async () => {
  preload.mockClear();
  expect(await preloadInitialRoute('/unrecognized-route')).toEqual([]);
  expect(preload).not.toHaveBeenCalled();
});

it('does not preload a public background for a private account page', async () => {
  preload.mockClear();
  await preloadInitialRoute('/customer/payments');
  expect(preload).not.toHaveBeenCalled();
});
