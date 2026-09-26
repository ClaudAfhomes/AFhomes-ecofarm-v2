import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert } from './Alert';
import { renderWithProviders } from '../test/utils';

describe('Alert', () => {
  it('renders danger alerts with role="alert"', () => {
    renderWithProviders(<Alert variant="danger">Boom</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('renders info alerts with role="status" and a title', () => {
    renderWithProviders(
      <Alert variant="info" title="Heads up">
        Details
      </Alert>,
    );
    const alert = screen.getByRole('status');
    expect(alert).toHaveTextContent('Heads up');
    expect(alert).toHaveTextContent('Details');
  });
});
