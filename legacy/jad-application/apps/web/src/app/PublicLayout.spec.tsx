import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PublicLayout } from './PublicLayout';
import { renderWithProviders } from '../test/utils';

/**
 * `.navOpen` is the CSS-module class that drives the opened (visible) state of
 * the mobile nav (MobileNavigation.module.css). Asserting it verifies the actual
 * collapsed/expanded behavior that jsdom cannot compute from stylesheets.
 * Queries for nav links are scoped to the primary nav because the footer
 * re-lists the same labels.
 */
const NAV_OPEN_RE = /navOpen/;
const NAV_LABELS = ['Home', 'About Us', 'Properties', 'FAQs', 'Contact'];

function primaryNav(): HTMLElement | null {
  return document.querySelector('#primary-nav');
}

describe('PublicLayout', () => {
  it('renders skip link and footer; navigation renders after opening the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const label of NAV_LABELS) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('starts collapsed: nav is closed, aria-expanded is false, aria-controls targets the nav', () => {
    renderWithProviders(<PublicLayout />);

    const nav = primaryNav();
    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'primary-nav');
    expect(nav).not.toHaveClass(NAV_OPEN_RE);
  });

  it('toggles the menu open and closed with matching visual and ARIA state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />);

    const nav = primaryNav();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(nav).toHaveClass(NAV_OPEN_RE);
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(nav).not.toHaveClass(NAV_OPEN_RE);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('closes the mobile menu after selecting a navigation item', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />);

    const nav = primaryNav();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(nav).toHaveClass(NAV_OPEN_RE);

    await user.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'About Us',
      }),
    );
    expect(nav).not.toHaveClass(NAV_OPEN_RE);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('supports keyboard toggling (Enter) of the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />);

    const nav = primaryNav();
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    toggle.focus();

    await user.keyboard('{Enter}');
    expect(nav).toHaveClass(NAV_OPEN_RE);
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes the mobile menu on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />);

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(primaryNav()).toHaveClass(NAV_OPEN_RE);

    await user.keyboard('{Escape}');
    expect(primaryNav()).not.toHaveClass(NAV_OPEN_RE);
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('marks the active navigation link with aria-current after opening the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicLayout />, { route: '/about' });

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'About Us',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('renders the floating Messenger link on every public page via the shared layout', () => {
    renderWithProviders(<PublicLayout />);

    const messenger = screen.getByRole('link', {
      name: 'Message JA&D Realty Services on Messenger',
    });
    expect(messenger).toHaveAttribute('href', 'https://m.me/JADRealtyServices');
    expect(messenger).toHaveAttribute('target', '_blank');
    expect(messenger).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(['/login', '/register'])('hides the floating Messenger link on %s', (route) => {
    renderWithProviders(<PublicLayout />, { route });

    expect(
      screen.queryByRole('link', { name: 'Message JA&D Realty Services on Messenger' }),
    ).not.toBeInTheDocument();
  });
});
