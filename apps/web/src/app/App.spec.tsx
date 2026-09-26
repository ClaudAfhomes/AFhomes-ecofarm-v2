import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../test/utils';
import App from './App';

describe('public site shell', () => {
  it('mounts and identifies the platform without exposing JAD branding', () => {
    renderWithProviders(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Public site under construction',
    );
    expect(screen.getByText('AF Homes Ecofarm')).toBeInTheDocument();
    expect(document.title).not.toMatch(/JA&D|JAD Realty/i);
  });

  it('links staff to the administration console', () => {
    renderWithProviders(<App />);

    expect(screen.getByRole('link', { name: 'Staff administration' })).toHaveAttribute(
      'href',
      expect.stringContaining('5174'),
    );
  });
});
