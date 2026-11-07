import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { emptyHolder } from './official-forms-fields';
import { ApplicationReview } from './ApplicationReview';

it('reviews every information section, distinguishes optional omissions and returns to its fields', () => {
  const edit = vi.fn();
  renderWithProviders(
    <ApplicationReview
      primary={{ ...emptyHolder('PRIMARY'), firstName: 'MARIA', lastName: 'SANTOS' }}
      secondary={null}
      planName="Gold VIP"
      tier="GOLD"
      paymentScheme="spot_cash"
      idType="passport"
      idNumber="P1234567"
      idFilename="passport.png"
      kind="OST"
      nodes={[]}
      meta={{
        svdStaffId: '',
        ssmStaffId: '',
        smStaffId: '',
        referrerStaffId: '',
        vipRecommenderName: '',
        recommenderContact: '',
        recommenderEmail: '',
        acknowledgedAt: '2026-11-06',
      }}
      channels={[]}
      consent
      onEdit={edit}
    />,
  );
  const personal = screen.getByRole('region', { name: 'Customer personal information' });
  expect(within(personal).getByText('MARIA')).toBeVisible();
  expect(within(personal).getAllByText('Not provided (optional)').length).toBeGreaterThan(0);
  expect(within(personal).getAllByText('Required — not provided').length).toBeGreaterThan(0);
  expect(screen.getByRole('region', { name: 'Address information' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Contact information' })).toBeVisible();
  expect(screen.getByText('P1234567')).toBeVisible();
  expect(screen.getByText('passport.png')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Address information' }));
  expect(edit).toHaveBeenCalledWith(2, 'primary-address');
});
