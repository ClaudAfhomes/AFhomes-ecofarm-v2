import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { PublicNavLink } from './PublicNavLink';
import { renderWithProviders } from '../test/utils';

describe('PublicNavLink', () => {
  let scrollToSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    scrollToSpy.mockRestore();
  });

  it('renders a router link for internal routes', () => {
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>);

    expect(screen.getByRole('link', { name: 'About Us' })).toHaveAttribute('href', '/about');
  });

  it('applies active class when route matches', () => {
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>, { route: '/about' });

    expect(screen.getByRole('link', { name: 'About Us' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not reset scroll itself - scroll reset is centralized in <ScrollToTop />', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>);

    await user.click(screen.getByRole('link', { name: 'About Us' }));

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('calls onClick handler before navigation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <PublicNavLink to="/about" onClick={onClick}>
        About Us
      </PublicNavLink>,
    );

    await user.click(screen.getByRole('link', { name: 'About Us' }));

    expect(onClick).toHaveBeenCalled();
  });

  it('does not navigate if onClick calls preventDefault', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn((e: React.MouseEvent<HTMLAnchorElement>) => e.preventDefault());
    renderWithProviders(
      <PublicNavLink to="/about" onClick={onClick}>
        About Us
      </PublicNavLink>,
    );

    await user.click(screen.getByRole('link', { name: 'About Us' }));

    expect(onClick).toHaveBeenCalled();
  });

  it('does not intercept navigation with modifier keys (metaKey)', () => {
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>);
    const link = screen.getByRole('link', { name: 'About Us' });

    fireEvent.click(link, { metaKey: true });

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('does not intercept navigation with modifier keys (ctrlKey)', () => {
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>);
    const link = screen.getByRole('link', { name: 'About Us' });

    fireEvent.click(link, { ctrlKey: true });

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('does not intercept right-click', () => {
    renderWithProviders(<PublicNavLink to="/about">About Us</PublicNavLink>);
    const link = screen.getByRole('link', { name: 'About Us' });

    fireEvent.click(link, { button: 2 });

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('supports end prop for exact matching', () => {
    renderWithProviders(
      <PublicNavLink to="/" end>
        Home
      </PublicNavLink>,
      { route: '/' },
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark as active when route does not match', () => {
    renderWithProviders(
      <PublicNavLink to="/" end>
        Home
      </PublicNavLink>,
      { route: '/about' },
    );

    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
});
