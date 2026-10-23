import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import SaleTeamSearch from './SaleTeamSearch';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ request: api.request }));
vi.mock('../components/ui/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@afhomes/ui', async (original) => ({
  ...(await original<typeof import('@afhomes/ui')>()),
  TurnstileChallenge: ({ onToken }: { onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken('synthetic-captcha')}>
      Complete test CAPTCHA
    </button>
  ),
}));
const record = {
  aaNumber: 'AAI26100001',
  kind: 'IST',
  maskedName: 'Synthetic S*****',
  status: 'accredited',
  expiresOn: null,
  photoUrl: null,
};
beforeEach(() => {
  sessionStorage.clear();
  api.request.mockReset();
  api.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/config'))
      return {
        available: true,
        localPreview: true,
        noticeVersion: 'v1',
        privacyNotice: 'Synthetic privacy notice.',
        verificationPhone: '+63 960-431-6867',
        siteKey: 'test-key',
      };
    if (path.endsWith('/start')) return { searchToken: 'synthetic-flow' };
    if (path.endsWith('/reveal')) return { result: record, contactReceipt: 'synthetic-receipt' };
    throw new Error('Unexpected request');
  });
});
async function begin() {
  await screen.findByText('Privacy notice — Data Privacy Act of 2012');
  const field = screen.getByLabelText('AA number');
  await userEvent.clear(field);
  await userEvent.type(field, record.aaNumber);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('dialog', { name: 'Privacy notice' });
}
async function acknowledge() {
  await userEvent.click(screen.getByRole('checkbox', { name: /I acknowledge/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}
async function enterContact() {
  await userEvent.type(await screen.findByLabelText('Name'), 'Synthetic Searcher');
  await userEvent.type(screen.getByLabelText('Email'), 'searcher@example.invalid');
  await userEvent.type(screen.getByLabelText('Mobile'), '09171234567');
  await userEvent.click(screen.getByRole('button', { name: 'Complete test CAPTCHA' }));
  await userEvent.click(screen.getByRole('button', { name: 'Verify accreditation' }));
}
it('shows when the daily search allowance is disabled', async () => {
  api.request.mockResolvedValueOnce({ available:true, dailyLimitEnabled:false, localPreview:true, noticeVersion:'v1',privacyNotice:'Synthetic privacy notice.',verificationPhone:'+639604316867',siteKey:'test-key' });
  renderWithProviders(<SaleTeamSearch />);
  expect(await screen.findByText(/The daily search limit is currently disabled/)).toBeVisible();
  expect(screen.queryByText(/Up to 3 successful verifications/)).not.toBeInTheDocument();
});
it('requires CAPTCHA, acknowledgment and contact before revealing a masked result', async () => {
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  expect(api.request.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false);
  expect(screen.queryByText(record.maskedName)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await acknowledge();
  expect(screen.getByRole('button', { name: 'Verify accreditation' })).toBeDisabled();
  await enterContact();
  expect(await screen.findByText(record.maskedName)).toBeInTheDocument();
  expect(screen.getByText('Employee identity')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '+63 960-431-6867' })).toHaveAttribute(
    'href',
    'tel:+639604316867',
  );
  expect(sessionStorage.getItem('afhomes.saleTeamSearch.session')).not.toContain(
    'searcher@example.invalid',
  );
  const call = api.request.mock.calls.find(([path]) => path.endsWith('/reveal'))!;
  expect(JSON.parse(call[2].body).contact.mobile).toBe('+639171234567');
});
it('reuses contact receipt while requiring CAPTCHA and acknowledgment for another search', async () => {
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  await screen.findByText(record.maskedName);
  await begin();
  await acknowledge();
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verify accreditation' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Complete test CAPTCHA' }));
  await userEvent.click(screen.getByRole('button', { name: 'Verify accreditation' }));
  await screen.findByText(record.maskedName);
  const calls = api.request.mock.calls.filter(([path]) => path.endsWith('/reveal'));
  expect(JSON.parse(calls[1]![2].body).contactReceipt).toBe('synthetic-receipt');
  expect(JSON.parse(calls[1]![2].body).contact).toBeUndefined();
});
it('discards a canceled start and never reveals its late response', async () => {
  let finish: (value: unknown) => void = () => {};
  const defaults = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, ...args) =>
    path.endsWith('/start')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaults(path, ...args),
  );
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => finish({ searchToken: 'late-flow' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText(record.maskedName)).not.toBeInTheDocument();
  expect(api.request.mock.calls.some(([path]) => path.endsWith('/reveal'))).toBe(false);
});
it('rejects malformed input before starting a lookup', async () => {
  renderWithProviders(<SaleTeamSearch />);
  await screen.findByText('Privacy notice — Data Privacy Act of 2012');
  await userEvent.type(screen.getByLabelText('AA number'), '%');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Enter a valid AA number.')).toBeInTheDocument();
  expect(api.request.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false);
});

it('keeps an initial visible when the signed profile photo cannot load', async () => {
  const defaults = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, ...args) =>
    path.endsWith('/reveal')
      ? Promise.resolve({
          result: { ...record, photoUrl: 'https://example.invalid/photo.jpg' },
          contactReceipt: 'receipt',
        })
      : defaults(path, ...args),
  );
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  fireEvent.error(await screen.findByRole('img', { name: record.maskedName }));
  expect(screen.getByText('S', { selector: 'span' })).toBeVisible();
});

it('opens and closes a larger photo and groups the name with the AA number', async () => {
  const defaults = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, ...args) =>
    path.endsWith('/reveal')
      ? Promise.resolve({ result: { ...record, kind: 'OST', expiresOn: '2027-10-21', photoUrl: 'https://example.invalid/photo.jpg' }, contactReceipt: 'receipt' })
      : defaults(path, ...args),
  );
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  const identity = within(await screen.findByRole('group', { name: 'Seller identity' }));
  expect(identity.getByRole('heading', { name: record.maskedName })).toBeInTheDocument();
  expect(identity.getByText(record.aaNumber)).toBeInTheDocument();
  const dl = screen.getByTestId('accreditation-details');
  expect(within(dl).getByText('Registration Status')).toBeInTheDocument();
  expect(within(dl).getByText('Accredited')).toBeInTheDocument();
  expect(screen.queryByText('2027-10-21')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Enlarge profile photo' }));
  expect(screen.getByRole('dialog', { name: 'Profile photo' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Profile photo' })).not.toBeInTheDocument();
});
