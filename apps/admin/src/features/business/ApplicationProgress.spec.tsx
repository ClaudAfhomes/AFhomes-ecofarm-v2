import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ApplicationProgress } from './ApplicationProgress';

it('keeps all seven steps behind a compact menu and prevents skipping validation', () => {
  const navigate = vi.fn();
  const steps = [
    'Application',
    'Identity',
    'Holders',
    'Network',
    'Channel',
    'Certify',
    'Review',
  ].map((label, i) => ({ id: `step-${i}`, label, done: i < 2 }));
  renderWithProviders(
    <ApplicationProgress steps={steps} activeStep={2} maxReached={3} onNavigate={navigate} />,
  );
  expect(screen.getByText('Step 3 of 7 · Holders')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Go to Review' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /All steps/ }));
  const menu = screen.getByRole('list');
  expect(within(menu).getAllByRole('button')).toHaveLength(7);
  expect(within(menu).getByRole('button', { name: 'Review' })).toBeDisabled();
  expect(within(menu).getByRole('button', { name: 'Holders' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  fireEvent.click(within(menu).getByRole('button', { name: 'Application' }));
  expect(navigate).toHaveBeenCalledWith(0);
  expect(screen.getByRole('button', { name: /All steps/ })).toHaveFocus();
  expect(screen.getByRole('button', { name: /All steps/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
