import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EligibilitySection } from './EligibilitySection';
import { mockFetchRoutes } from '../../../test/utils';
import { renderWithProviders } from '../../../test/utils';

describe('EligibilitySection', () => {
  it('renders the minimum age from public config', async () => {
    mockFetchRoutes({ '/config/public': { minimumAge: 18, genders: ['Male', 'Female'] } });
    renderWithProviders(<EligibilitySection />);

    expect(await screen.findByText('Minimum age to join:')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('renders an error state when the config endpoint fails', async () => {
    mockFetchRoutes({
      '/config/public': {
        body: {
          error: { code: 'INTERNAL', message: 'Server error', timestamp: '2026-08-18T10:00:00Z' },
        },
        status: 500,
      },
    });
    renderWithProviders(<EligibilitySection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  });
});
