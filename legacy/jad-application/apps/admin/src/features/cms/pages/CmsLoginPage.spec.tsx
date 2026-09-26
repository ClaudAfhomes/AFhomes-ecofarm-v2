import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { loginContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsLoginPage } from './CmsLoginPage';
import {
  __getLoginSeed,
  __resetCmsForTests,
  __resetLoginForTests,
  getLogin,
} from '../services/cmsRepository';

function renderLogin(route = '/admin/cms/login', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsLoginPage />, { route, user });
}

describe('CmsLoginPage - Login CMS module', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetLoginForTests();
    __resetCmsForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Login CMS', async () => {
    renderLogin('/admin/cms/login', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Login CMS')).toBeInTheDocument();
    expect(
      screen.getByText(/Edit the member sign-in screen: brand assets, copy, form field labels/),
    ).toBeInTheDocument();
  });

  it('MEMBER cannot access Login CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/login']}>
            <Routes>
              <Route
                path="/admin/cms/login"
                element={
                  <RequireRole>
                    <CmsLoginPage />
                  </RequireRole>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('renders all three Login sections', async () => {
    renderLogin();
    expect(await screen.findByRole('heading', { name: 'Login Screen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Login Form Fields' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Submit & Links' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Brand Mark/ })).not.toBeInTheDocument();
  });

  it('initial CMS values match the seed (alignment)', async () => {
    const seed = __getLoginSeed();
    expect(seed.copy.title).toBe('Welcome back');
    expect(seed.copy.brandTitle).toBe('Where Big Dreams meet property that already earns');
    expect(seed.fields.identifier.label).toBe('Email or phone number');
    expect(seed.fields.password.label).toBe('Password');
    expect(seed.submitLabel).toBe('Sign In');
    expect(seed.forgotPassword.label).toBe('Forgot password?');
    expect(seed.registerPrompt.text).toBe("Don't have a JA&D account yet?");
    expect(seed.registerPrompt.linkLabel).toBe('Create your account');

    const viaRepo = await getLogin();
    expect(viaRepo).toEqual(seed);
  });

  it('cms schema validates the login seed', async () => {
    const seed = __getLoginSeed();
    expect(loginContentSchema.safeParse(seed).success).toBe(true);
  });

  it('allows editing the login screen title', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Login Screen' });
    const titleInput = (await screen.findByDisplayValue('Welcome back')) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Sign in to JA&D');
    expect(screen.getByDisplayValue('Sign in to JA&D')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
  });

  it('allows editing a login form field label', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Login Form Fields' });
    await user.click(screen.getByRole('button', { name: /Login Form Fields section/ }));
    const labelInput = screen.getByDisplayValue('Email or phone number') as HTMLInputElement;
    await user.clear(labelInput);
    await user.type(labelInput, 'Email / mobile');
    expect(screen.getByDisplayValue('Email / mobile')).toBeInTheDocument();
  });

  it('dirty state: Cancel restores, Save persists', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Login Screen' });
    const titleInput = (await screen.findByDisplayValue('Welcome back')) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Login Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('Welcome back')).toBeInTheDocument();

    const restored = screen.getByDisplayValue('Welcome back') as HTMLInputElement;
    await user.clear(restored);
    await user.type(restored, 'Saved Login Title');
    await user.click(screen.getByText('Save'));
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved Login Title')).toBeInTheDocument();
  });

  it('validation: empty required title shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole('heading', { name: 'Login Screen' });
    const titleInput = (await screen.findByDisplayValue('Welcome back')) as HTMLInputElement;
    await user.clear(titleInput);
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('CMS navigation exposes Login and Register under Website CMS with divider', async () => {
    const { ADMIN_NAV_ITEMS } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem?.label).toBe('Website CMS');
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/login' && d.label === 'Login',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/register' && d.label === 'Register',
      ),
    ).toBe(true);
    expect(cmsItem?.dropdown?.some((d) => 'divider' in d)).toBe(true);
    const globalIdx =
      cmsItem?.dropdown?.findIndex((d) => !('divider' in d) && d.to === '/admin/cms/global') ?? -1;
    const loginIdx =
      cmsItem?.dropdown?.findIndex((d) => !('divider' in d) && d.to === '/admin/cms/login') ?? -1;
    const dividerIdx = cmsItem?.dropdown?.findIndex((d) => 'divider' in d) ?? -1;
    expect(dividerIdx).toBeGreaterThan(globalIdx);
    expect(loginIdx).toBeGreaterThan(dividerIdx);
  });
});
