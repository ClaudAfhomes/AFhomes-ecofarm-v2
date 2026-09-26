import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AboutPage } from './AboutPage';
import { renderWithProviders } from '../../../test/utils';

describe('AboutPage', () => {
  it('renders the page heading and the company story sections', () => {
    renderWithProviders(<AboutPage />);

    expect(
      screen.getByRole('heading', { name: /about ja&d realty services/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Property that already works.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Three readings of our name.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Due diligence is non-negotiable.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /to be the brokerage that filipinos/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our mission' })).toBeInTheDocument();
  });

  it('tells the story of the three readings of the name', () => {
    renderWithProviders(<AboutPage />);

    expect(
      screen.getByRole('heading', { name: 'Judicious Advisory & Diligence' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Journey of Achievable & Dependable' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Just Aspirations & Dreams' })).toBeInTheDocument();
  });

  it('presents the approach points and the mission structure', () => {
    renderWithProviders(<AboutPage />);

    expect(screen.getByRole('heading', { name: 'Due diligence first' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Complete documentation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clear boundaries' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Connect buyers and sellers' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Serve clients at home and abroad' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rigorous due diligence' })).toBeInTheDocument();
  });
});
