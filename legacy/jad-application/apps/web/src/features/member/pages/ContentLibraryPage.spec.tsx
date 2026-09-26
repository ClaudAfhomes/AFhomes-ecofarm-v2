import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER, setMockSessionUser } from '@jad/mock';
import { createMemberMockServer } from '../../../mock';

import { ContentLibraryPage } from './ContentLibraryPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

describe('member ContentLibraryPage', () => {
  let server: ReturnType<typeof createMemberMockServer>;

  beforeEach(() => {
    server = createMemberMockServer();
    server.install();
    setMockSessionUser(MOCK_MEMBER);
  });

  afterEach(() => {
    server.restore();
    setMockSessionUser(null);
  });

  it('renders the marketing tools gallery with covers, view, download and forward links (SCR-MEM-022)', async () => {
    renderMember(<ContentLibraryPage />, { user: MOCK_MEMBER });

    // Marketing Tools - 12 items (canonical seed from @jad/mock)
    expect(await screen.findByText('JA&D Membership Overview')).toBeInTheDocument();
    expect(screen.getByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.getByText('JA&D Opportunity Video')).toBeInTheDocument();
    expect(screen.getByText('JA&D Program Brochure')).toBeInTheDocument();
    expect(screen.getByText('JA&D Property Lineup')).toBeInTheDocument();
    expect(screen.getByText('Virtual Office Tour')).toBeInTheDocument();
    expect(screen.getByText('Buyer Guide Checklist')).toBeInTheDocument();
    expect(screen.getByText('Community Open House Flyer')).toBeInTheDocument();
    expect(screen.getByText('Unit Turnover Checklist')).toBeInTheDocument();
    expect(screen.getByText('JA&D Social Starter Kit')).toBeInTheDocument();
    expect(screen.getByText('Member Welcome Video')).toBeInTheDocument();
    expect(screen.getByText('How Qualifying Sales Work')).toBeInTheDocument();

    // Kind chips - icons + labels present (card)
    expect(screen.getAllByText('Document').length).toBeGreaterThanOrEqual(7);
    expect(screen.getAllByText('Image').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Video').length).toBeGreaterThanOrEqual(3);

    // Header ring + timeframe + filters (breadcrumbs are owned by MemberLayout)
    expect(screen.getByRole('link', { name: 'View Vouchers' })).toHaveAttribute(
      'href',
      '/member/vouchers',
    );
    expect(screen.getAllByText('Marketing Tools').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Featured · Download-ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Showing 12 of 12 items/)).toBeInTheDocument();
    // Beautiful covers - image/video/pdf/doc covers visible before View
    expect(document.querySelector('[class*="coverWrap"]')).toBeInTheDocument();
    expect(document.querySelector('[class*="cover"]')).toBeInTheDocument();

    // View-only previews - no inline media before clicking View (dialog only)
    expect(screen.queryByLabelText('JA&D Opportunity Video')).not.toBeInTheDocument();

    // View is a button for every downloadable item (12 with downloadUrl)
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBeGreaterThanOrEqual(12);
    const downloads = screen.getAllByRole('link', { name: 'Download' });
    expect(downloads.length).toBeGreaterThanOrEqual(12);
    const docDownload = downloads.find(
      (a) => a.getAttribute('download') === 'JA&D Membership Overview',
    );
    expect(docDownload).toHaveAttribute('target', '_blank');
    expect(docDownload).toHaveAttribute('rel', 'noopener noreferrer');
    const pdfDownload = downloads.find(
      (a) => a.getAttribute('download') === 'JA&D Program Brochure',
    );
    expect(pdfDownload).toHaveAttribute(
      'href',
      'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    );

    // Share links remain server-provided (12 items now)
    expect(screen.getAllByRole('link', { name: 'Share on Messenger' }).length).toBe(12);
    expect(screen.getAllByRole('link', { name: 'Share on Messenger' })[0]).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(screen.getAllByRole('link', { name: 'Share on Messenger' })[0]).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(screen.getAllByRole('link', { name: 'Share on Viber' }).length).toBe(12);
    expect(screen.getAllByRole('button', { name: 'Copy link' }).length).toBe(12);
  });

  it('filters by marketing category with pills and resets', async () => {
    const user = userEvent.setup();
    renderMember(<ContentLibraryPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('JA&D Project Showcase')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Images' }));
    expect(screen.getByRole('button', { name: 'Images' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.queryByText('JA&D Opportunity Video')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 12 items · Images/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Videos' }));
    expect(screen.getByText('JA&D Opportunity Video')).toBeInTheDocument();
    expect(screen.queryByText('JA&D Project Showcase')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Brochures' }));
    expect(screen.getByText('JA&D Program Brochure')).toBeInTheDocument();
    expect(screen.queryByText('JA&D Project Showcase')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Flyers' }));
    expect(screen.getByText('JA&D Membership Overview')).toBeInTheDocument();
    expect(screen.queryByText('JA&D Opportunity Video')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.getByText('JA&D Opportunity Video')).toBeInTheDocument();
    expect(screen.getByText('JA&D Property Lineup')).toBeInTheDocument();
  });

  it('opens a lightbox dialog for image, video and pdf on View click only', async () => {
    const user = userEvent.setup();
    renderMember(<ContentLibraryPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.queryByLabelText('JA&D Opportunity Video')).not.toBeInTheDocument();
    expect(screen.queryByTitle('JA&D Program Brochure')).not.toBeInTheDocument();

    // Image - View button opens dialog with large preview (no inline before)
    const showcaseCard = screen.getByText('JA&D Project Showcase').closest('li')!;
    await user.click(within(showcaseCard).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('JA&D Project Showcase')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Video - View button opens dialog with video player (only after click)
    const videoCard = screen.getByText('JA&D Opportunity Video').closest('li')!;
    await user.click(within(videoCard).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('JA&D Opportunity Video')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // PDF - View button opens dialog with iframe (only after click)
    const pdfCard = screen.getByText('JA&D Program Brochure').closest('li')!;
    await user.click(within(pdfCard).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTitle('JA&D Program Brochure')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Plain document (data:text/plain) - View shows scrollable text, only after click
    const docCard = screen.getByText('JA&D Membership Overview').closest('li')!;
    expect(within(docCard).getByRole('button', { name: 'View' })).toBeInTheDocument();
    await user.click(within(docCard).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/JA&D offers a membership opportunity/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty state when no marketing tools are published', async () => {
    server.restore();
    mockFetchRoutes({ '/content/forwardable': { data: [], meta: {} } });
    renderMember(<ContentLibraryPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No marketing tools yet')).toBeInTheDocument();
  });
});
