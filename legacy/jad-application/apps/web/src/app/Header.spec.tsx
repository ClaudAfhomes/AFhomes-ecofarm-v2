import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Header } from './Header';
import styles from './Header.module.css';
import { renderWithProviders } from '../test/utils';

describe('Header', () => {
  it('renders the brand logo linking home', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('link', { name: 'JA&D Realty Services - home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('img', { name: 'JA&D Realty Services' })).toBeInTheDocument();
  });

  it('renders primary navigation without the Talk to Us call to action', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Talk to Us' })).not.toBeInTheDocument();
  });

  it('renders the Login and Register member auth actions', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
  });

  it('is solid (scrolled chrome) on auth routes with no hero backdrop', () => {
    renderWithProviders(<Header />, { route: '/login' });

    expect(screen.getByRole('banner')).toHaveClass(styles.solid!);
  });

  it('is solid (scrolled chrome) on property detail routes with no hero backdrop', () => {
    renderWithProviders(<Header />, { route: '/properties/residential/sample-lot-1' });

    expect(screen.getByRole('banner')).toHaveClass(styles.solid!);
  });

  it('stays transparent over the hero on other routes', () => {
    renderWithProviders(<Header />, { route: '/properties' });

    expect(screen.getByRole('banner')).not.toHaveClass(styles.solid!);
  });
});
