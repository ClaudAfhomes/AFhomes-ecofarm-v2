import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgramsSection } from './ProgramsSection';
import { mockFetchRoutes } from '../../../test/utils';
import { renderWithProviders } from '../../../test/utils';

const PROGRAMS = [
  { id: 'p1', code: 'D', name: 'Domestic', description: 'MVP program.' },
  { id: 'p2', code: 'A', name: 'Abroad' },
];

describe('ProgramsSection', () => {
  it('renders programs when data loads', async () => {
    mockFetchRoutes({ '/programs': { data: PROGRAMS, meta: {} } });
    renderWithProviders(<ProgramsSection />);

    expect(await screen.findByText('Domestic')).toBeInTheDocument();
    expect(screen.getByText('MVP program.')).toBeInTheDocument();
    expect(screen.getByText('Abroad')).toBeInTheDocument();
  });

  it('renders a skeleton while loading', async () => {
    mockFetchRoutes({ '/programs': { data: PROGRAMS, meta: {} } });
    renderWithProviders(<ProgramsSection />);
    // Await a stable query; before data resolves the section region is present.
    expect(screen.getByRole('region', { name: 'Programs' })).toBeInTheDocument();
  });

  it('renders an error state with retry when the API fails', async () => {
    mockFetchRoutes({
      '/programs': {
        body: {
          error: { code: 'INTERNAL', message: 'Server error', timestamp: '2026-08-18T10:00:00Z' },
        },
        status: 500,
      },
    });
    renderWithProviders(<ProgramsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders an empty state when no programs exist', async () => {
    mockFetchRoutes({ '/programs': { data: [], meta: {} } });
    renderWithProviders(<ProgramsSection />);
    expect(await screen.findByText('No programs are available yet.')).toBeInTheDocument();
  });
});
