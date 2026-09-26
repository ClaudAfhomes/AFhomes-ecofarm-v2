import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FaqsPage } from './FaqsPage';
import { renderWithProviders } from '../../../test/utils';

describe('FaqsPage', () => {
  it('renders the FAQ accordion with customer-friendly questions as buttons', () => {
    renderWithProviders(<FaqsPage />);

    expect(
      screen.getByRole('heading', { name: /frequently asked questions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /what does ja&d realty services specialize in/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /does ja&d guarantee investment returns/i }),
    ).toBeInTheDocument();
  });

  it('keeps a clean heading hierarchy: h1 hero, h2 intro statement, h3 questions', () => {
    renderWithProviders(<FaqsPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: /frequently asked questions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Questions answered clearly.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 3,
        name: /what does ja&d realty services specialize in/i,
      }),
    ).toBeInTheDocument();
  });

  it('links the closing CTA to Messenger and the contact page', () => {
    renderWithProviders(<FaqsPage />);

    const letsTalk = screen.getByRole('link', { name: "Let's Talk" });
    expect(letsTalk).toHaveAttribute('href', 'https://m.me/JADRealtyServices');
    expect(letsTalk).toHaveAttribute('target', '_blank');
    expect(letsTalk).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.getByRole('link', { name: 'Contact Us' })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('link', { name: 'Ask us directly' })).toHaveAttribute(
      'href',
      '/contact',
    );
  });
});
