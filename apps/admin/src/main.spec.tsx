import { expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const startup = vi.hoisted(() => {
  let finishFlags!: () => void;
  const flags = new Promise<void>((resolve) => { finishFlags = resolve; });
  return { flags, finishFlags, auth: vi.fn(), render: vi.fn() };
});
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: startup.render }) }));
vi.mock('./app/App', () => ({ default: () => null }));
vi.mock('./app/preload-shell', () => ({ preloadAdminShell: async () => {} }));
vi.mock('./lib/session', () => ({ SessionProvider: () => null }));
vi.mock('./lib/feature-flags', () => ({ loadFeatureFlags: () => startup.flags }));
vi.mock('./lib/supabase', () => ({ getSupabaseClient: startup.auth }));

it('starts SDK session restoration while settings load, but keeps rendering gated', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./main');
  expect(startup.auth).toHaveBeenCalledTimes(1);
  expect(startup.render).not.toHaveBeenCalled();
  startup.finishFlags();
  await waitFor(() => expect(startup.render).toHaveBeenCalledTimes(1));
});
