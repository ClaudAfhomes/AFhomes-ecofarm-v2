import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { registerContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsRegisterPage } from './CmsRegisterPage';
import {
  __getRegisterSeed,
  __resetCmsForTests,
  __resetRegisterForTests,
  getRegister,
} from '../services/cmsRepository';

function renderRegister(route = '/admin/cms/register', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsRegisterPage />, { route, user });
}

describe('CmsRegisterPage - Register CMS module', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetRegisterForTests();
    __resetCmsForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access Register CMS', async () => {
    renderRegister('/admin/cms/register', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('Register CMS')).toBeInTheDocument();
    expect(
      screen.getByText(/Edit the member registration flow: brand, steps, form fields/),
    ).toBeInTheDocument();
  });

  it('MEMBER cannot access Register CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/register']}>
            <Routes>
              <Route
                path="/admin/cms/register"
                element={
                  <RequireRole>
                    <CmsRegisterPage />
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

  it('renders all seven Register sections', async () => {
    renderRegister();
    expect(await screen.findByRole('heading', { name: 'Register Screen' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Brand Mark/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wizard Step Titles' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Registration Form Fields' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Qualification Questions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email Verification' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Application Status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Submit & Links' })).toBeInTheDocument();
  });

  it('initial CMS values match the seed (alignment)', async () => {
    const seed = __getRegisterSeed();
    expect(seed.copy.title).toBe('Join JA&D');
    expect(seed.stepTitles.programProfile).toBe('Program & profile');
    expect(seed.stepTitles.account).toBe('Account');
    expect(seed.fields.firstName.label).toBe('First name');
    expect(seed.fields.consent.label).toContain('terms');
    expect(seed.qualification.domestic).toHaveLength(2);
    expect(seed.qualification.abroad).toHaveLength(2);
    expect(seed.submitLabel).toBe('Create My Account');
    expect(seed.loginPrompt.linkLabel).toBe('Sign in');

    const viaRepo = await getRegister();
    expect(viaRepo).toEqual(seed);
  });

  it('cms schema validates the register seed', async () => {
    const seed = __getRegisterSeed();
    expect(registerContentSchema.safeParse(seed).success).toBe(true);
  });

  it('allows editing the register screen title', async () => {
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('heading', { name: 'Register Screen' });
    const titleInput = (await screen.findByDisplayValue('Join JA&D')) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Create your JA&D account');
    expect(screen.getByDisplayValue('Create your JA&D account')).toBeInTheDocument();
  });

  it('allows editing a registration form field label', async () => {
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('heading', { name: 'Registration Form Fields' });
    await user.click(screen.getByRole('button', { name: /Registration Form Fields section/ }));
    const labelInput = screen.getByDisplayValue('First name') as HTMLInputElement;
    await user.clear(labelInput);
    await user.type(labelInput, 'Given name');
    expect(screen.getByDisplayValue('Given name')).toBeInTheDocument();
  });

  it('allows adding and removing a qualification question', async () => {
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('heading', { name: 'Qualification Questions' });
    await user.click(screen.getByRole('button', { name: /Qualification Questions section/ }));
    // Two domestic questions are seeded (q0 is the domestic "able to enter into a binding contract" wording)
    expect(
      (
        await screen.findAllByDisplayValue(
          /Are you at least 18 years old and able to enter into a binding contract/,
        )
      ).length,
    ).toBe(1);
    await user.click(screen.getByText('Add Domestic question'));
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    const emptyBox = boxes.find((b) => b.tagName === 'INPUT' && b.value === '') as HTMLInputElement;
    await user.type(emptyBox, 'New domestic question?');
    expect(screen.getByDisplayValue('New domestic question?')).toBeInTheDocument();
    const domestic = screen.getByRole('group', { name: 'Domestic' });
    const removeButtons = within(domestic).getAllByText('Remove');
    await user.click(removeButtons[removeButtons.length - 1]!);
    expect(screen.queryByDisplayValue('New domestic question?')).not.toBeInTheDocument();
  });

  it('dirty state: Cancel restores, Save persists', async () => {
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('heading', { name: 'Register Screen' });
    const titleInput = (await screen.findByDisplayValue('Join JA&D')) as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Register Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('Join JA&D')).toBeInTheDocument();

    const restored = screen.getByDisplayValue('Join JA&D') as HTMLInputElement;
    await user.clear(restored);
    await user.type(restored, 'Saved Register Title');
    await user.click(screen.getByText('Save'));
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved Register Title')).toBeInTheDocument();
  });

  it('validation: empty required title shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderRegister();
    await screen.findByRole('heading', { name: 'Register Screen' });
    const titleInput = (await screen.findByDisplayValue('Join JA&D')) as HTMLInputElement;
    await user.clear(titleInput);
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeDisabled();
  });
});
