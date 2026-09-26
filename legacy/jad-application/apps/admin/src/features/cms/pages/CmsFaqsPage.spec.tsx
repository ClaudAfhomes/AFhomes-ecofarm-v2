import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MOCK_MEMBER, MOCK_SUPER_ADMIN } from '@jad/mock';
import { faqContentSchema } from '@jad/contracts';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CmsFaqsPage } from './CmsFaqsPage';
import { __getFaqsSeed, __resetFaqsForTests, getFaqs } from '../services/cmsRepository';

function renderCms(route = '/admin/cms/faqs', user = MOCK_SUPER_ADMIN) {
  return renderWithProviders(<CmsFaqsPage />, { route, user });
}

describe('CmsFaqsPage - Phase 4 FAQ CMS', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    __resetFaqsForTests();
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
    vi.restoreAllMocks();
  });

  it('SUPER_ADMIN can access FAQs CMS', async () => {
    renderCms('/admin/cms/faqs', MOCK_SUPER_ADMIN);
    expect(await screen.findByText('FAQs CMS')).toBeInTheDocument();
    expect(screen.getByText(/Manage the public FAQs/)).toBeInTheDocument();
  });

  it('MEMBER cannot access FAQs CMS (Forbidden)', async () => {
    const { RequireRole } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={MOCK_MEMBER as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/faqs']}>
            <Routes>
              <Route
                path="/admin/cms/faqs"
                element={
                  <RequireRole>
                    <CmsFaqsPage />
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

  it('unauthenticated user is redirected to VITE_WEB_URL/login', async () => {
    const { RequireRole, getValidatedWebLoginUrl } = await import('../../../app/RequireRole');
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { SessionProvider } = await import('../../../lib/session');
    expect(getValidatedWebLoginUrl()).toMatch(/\/login$/);
    expect(getValidatedWebLoginUrl()).toContain('5173');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { render } = await import('@testing-library/react');
    render(
      <SessionProvider initialUser={null as never} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/cms/faqs']}>
            <Routes>
              <Route
                path="/admin/cms/faqs"
                element={
                  <RequireRole>
                    <CmsFaqsPage />
                  </RequireRole>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
    expect(screen.queryByText('FAQs CMS')).not.toBeInTheDocument();
  });

  it('Website CMS navigation entry is visible to SUPER_ADMIN for FAQs', async () => {
    const { ADMIN_NAV_ITEMS, canAccess } = await import('../../../app/navigation');
    const cmsItem = ADMIN_NAV_ITEMS.find((i) => i.to === '/admin/cms');
    expect(cmsItem).toBeDefined();
    expect(cmsItem?.label).toBe('Website CMS');
    expect(canAccess(MOCK_SUPER_ADMIN.role as never, cmsItem!)).toBe(true);
    expect(cmsItem?.dropdown?.some((d) => !('divider' in d) && d.to === '/admin/cms/faqs')).toBe(
      true,
    );
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.to === '/admin/cms/faqs' && d.label === 'FAQs',
      ),
    ).toBe(true);
    expect(
      cmsItem?.dropdown?.some(
        (d) => !('divider' in d) && d.label.includes('Coming soon') && d.to === '/admin/cms/faqs',
      ),
    ).toBe(false);
  });

  it('renders all five FAQs sections', async () => {
    renderCms();
    expect(await screen.findByRole('heading', { name: 'Page Header' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FAQs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTA Band' })).toBeInTheDocument();
  });

  it('initial CMS values match public FAQs content (alignment)', async () => {
    const seed = __getFaqsSeed();
    expect(seed.eyebrow).toBe('FAQs');
    expect(seed.title).toBe('Frequently asked questions');
    expect(seed.hero.lead).toBe(
      'Concise, plain-language answers to the questions buyers and sellers ask us most - before you talk to us.',
    );
    expect(seed.hero.primaryCta).toEqual({ label: 'Talk to Us', to: '/contact' });
    expect(seed.intro.statement).toBe('Questions answered clearly.');
    expect(seed.cta.title).toBe('Still have questions?');
    expect(seed.cta.primaryCta).toEqual({
      label: "Let's Talk",
      href: 'https://m.me/JADRealtyServices',
    });
    expect(seed.items).toHaveLength(6);
    expect(seed.items[0]?.question).toBe('What does JA&D Realty Services specialize in?');
    expect(seed.items[5]?.question).toBe('Does JA&D guarantee investment returns?');
    const viaRepo = await getFaqs();
    expect(viaRepo).toEqual(seed);
  });

  it('cms schema validates the seed', async () => {
    const seed = __getFaqsSeed();
    const parsed = faqContentSchema.safeParse(seed);
    expect(parsed.success).toBe(true);
  });

  it('renders FAQ items in their section', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /FAQs/ }));
    expect(screen.getByText('What does JA&D Realty Services specialize in?')).toBeInTheDocument();
    expect(screen.getByText(/We are a real-estate brokerage specializing/)).toBeInTheDocument();
    expect(screen.getByText('Does JA&D guarantee investment returns?')).toBeInTheDocument();
  });

  it('allows text editing FAQ items', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /FAQs/ }));

    // Click Edit on the first FAQ row
    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    // Wait for dialog to appear
    const dialog = await screen.findByRole('dialog');
    const questionTextarea = within(dialog).getByDisplayValue(
      'What does JA&D Realty Services specialize in?',
    );
    fireEvent.change(questionTextarea, { target: { value: 'Updated question?' } });

    // Save & close the dialog
    await user.click(within(dialog).getByText('Save & close'));

    // Wait for dialog to disappear
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Check the updated text appears in the list
    expect(screen.getByText('Updated question?')).toBeInTheDocument();
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
  });

  it('dirty state: Cancel restores, Save updates local state', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    const titleInput = screen.getByDisplayValue('Frequently asked questions') as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, 'Dirty Title');
    await user.click(screen.getByText('Cancel'));
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument();
    await user.click(screen.getByText('Discard'));
    expect(screen.getByDisplayValue('Frequently asked questions')).toBeInTheDocument();
    expect(screen.queryByText('Dirty Title')).not.toBeInTheDocument();

    const restored = screen.getByDisplayValue('Frequently asked questions') as HTMLInputElement;
    await user.clear(restored);
    await user.type(restored, 'Saved Title');
    await user.click(screen.getByText('Save'));
    expect((await screen.findAllByText(/All changes saved/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Saved Title')).toBeInTheDocument();
  });

  it('validation: empty required question shows error and disables Save', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /FAQs/ }));

    // Click Edit on the first FAQ row
    const editBtns = screen.getAllByText('Edit');
    await user.click(editBtns[0]!);

    // Wait for dialog to appear
    const dialog = await screen.findByRole('dialog');
    const questionTextarea = within(dialog).getByDisplayValue(
      'What does JA&D Realty Services specialize in?',
    );
    await user.clear(questionTextarea);

    // Check that Save on the main page is disabled
    await waitFor(() => expect(screen.getByText('Save')).toBeDisabled());
  });

  it('ordering: Move up/down reorders items', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /FAQs/ }));

    // Verify initial order
    expect(screen.getByText('What does JA&D Realty Services specialize in?')).toBeInTheDocument();
    expect(screen.getByText('What is a tenanted property?')).toBeInTheDocument();

    // Click the move down button on the first item (index 0)
    const moveDownBtns = screen.getAllByText('↓');
    await user.click(moveDownBtns[0]!);

    // After move, second question should now be first
    const allQuestionTexts = screen.getAllByText(
      /What does JA&D|What is a tenanted|How does the brokerage/,
    );
    expect(allQuestionTexts[0]).toHaveTextContent('What is a tenanted property?');

    // Move it back up
    const moveUpBtns = screen.getAllByText('↑');
    await user.click(moveUpBtns[1]!);
    expect(screen.getByText('What does JA&D Realty Services specialize in?')).toBeInTheDocument();
  });

  it('add/remove FAQ items', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /FAQs/ }));

    // Click Add FAQ item
    await user.click(screen.getByText('Add FAQ item'));

    // Wait for dialog to appear with "New question?" in the textarea
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('New question?')).toBeInTheDocument();

    // Close the dialog via Save & close
    await user.click(within(dialog).getByText('Save & close'));

    // Check that a new row with "New question?" text appears in the list
    expect(screen.getByText('New question?')).toBeInTheDocument();

    // Click Remove on the new item row
    const removeBtns = screen.getAllByText('Remove');
    await user.click(removeBtns[removeBtns.length - 1]!);

    // Confirm the delete in the ConfirmDialog
    const confirmDialog = await screen.findByRole('dialog', { name: 'Delete FAQ item?' });
    await user.click(within(confirmDialog).getByText('Delete'));

    // Verify the new item is removed
    expect(screen.queryByText('New question?')).not.toBeInTheDocument();
  });

  it('image handling: hero image alt editing', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    await user.click(screen.getByRole('button', { name: /Hero/ }));
    const altInput = screen.getByDisplayValue('A contemporary development building');
    await user.clear(altInput);
    await user.type(altInput, 'Custom hero alt');
    expect(screen.getByDisplayValue('Custom hero alt')).toBeInTheDocument();
  });

  it('anchor nav and collapsible sections work', async () => {
    const user = userEvent.setup();
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText(/Sections \(5\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Page Header/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /FAQs/ })).toBeInTheDocument();

    // FAQs collapsed initially - question text not visible
    expect(
      screen.queryByText('What does JA&D Realty Services specialize in?'),
    ).not.toBeInTheDocument();

    // Expand FAQs section
    await user.click(screen.getByRole('button', { name: /FAQs/ }));
    expect(screen.getByText('What does JA&D Realty Services specialize in?')).toBeInTheDocument();

    // Collapse all
    await user.click(screen.getByText(/Collapse all/));
    expect(
      screen.queryByText('What does JA&D Realty Services specialize in?'),
    ).not.toBeInTheDocument();

    // Expand all
    await user.click(screen.getByText(/Expand all/));
    expect(screen.getByText('What does JA&D Realty Services specialize in?')).toBeInTheDocument();
  });

  it('shows All changes saved, not Published', async () => {
    renderCms();
    await screen.findByRole('heading', { name: 'Page Header' });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('CTA URL validation rejects unsafe schemes', async () => {
    const seed = __getFaqsSeed();
    const parsed = faqContentSchema.safeParse({
      ...seed,
      cta: { ...seed.cta, primaryCta: { label: 'Bad', href: 'javascript:alert(1)' } },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('http'))).toBe(true);
    }
  });
});
