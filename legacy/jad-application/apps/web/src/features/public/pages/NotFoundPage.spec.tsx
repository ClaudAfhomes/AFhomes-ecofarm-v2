import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotFoundPage } from './NotFoundPage';
import { renderWithProviders } from '../../../test/utils';

describe('NotFoundPage', () => {
  it('renders a friendly 404 with actions home and to properties', () => {
    renderWithProviders(<NotFoundPage />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Explore Properties' })).toHaveAttribute(
      'href',
      '/properties',
    );
  });
});
