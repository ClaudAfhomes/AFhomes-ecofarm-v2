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
        dailyLimitEnabled: true,
        localPreview: true,
        noticeVersion: 'v1',
        privacyNotice: 'Synthetic privacy notice.',
        verificationPhone: '+63 960-431-6867',
        siteKey: 'test-key',
        supportHeading: 'Customer Support & Payment Inquiries',
        supportEmail: 'info@afhomes.com.ph',
        supportPhone: '+63 960 431 6867',
        bankHolder: 'AFhomes Hotspring & Ecofarm Resort Corp.',
        bank1Name: 'SECURITY BANK',
        bank1Account: '0000082595577',
        bank2Name: 'CHINABANK',
        bank2Account: '150700006468',
        checkPayee: 'AFhomes Hotspring & Ecofarm Resort Corp.',
        bankReminder:
          'Please double-check the provided company bank account details before sending any payment. Thank you!',
        agentReminder:
          'A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.',
      };
    if (path.endsWith('/start')) return { searchToken: 'synthetic-flow' };
    if (path.endsWith('/reveal')) return { result: record, contactReceipt: 'synthetic-receipt' };
    throw new Error('Unexpected request');
  });
});
async function begin() {
  await screen.findByText(
    (_, element) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim() ===
      'Privacy notice: Data Privacy Act of 2012',
    { selector: 'summary' },
  );
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
  api.request.mockResolvedValueOnce({
    available: true,
    dailyLimitEnabled: false,
    localPreview: true,
    noticeVersion: 'v1',
    privacyNotice: 'Synthetic privacy notice.',
    verificationPhone: '+639604316867',
    siteKey: 'test-key',
    supportHeading: 'Customer Support & Payment Inquiries',
    supportEmail: 'info@afhomes.com.ph',
    supportPhone: '+63 960 431 6867',
    bankHolder: 'AFhomes Hotspring & Ecofarm Resort Corp.',
    bank1Name: 'SECURITY BANK',
    bank1Account: '0000082595577',
    bank2Name: 'CHINABANK',
    bank2Account: '150700006468',
    checkPayee: 'AFhomes Hotspring & Ecofarm Resort Corp.',
    bankReminder:
      'Please double-check the provided company bank account details before sending any payment. Thank you!',
    agentReminder:
      'A friendly reminder: All agents are strictly prohibited from directly collecting payments from buyers.',
  });
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
  expect(screen.getByText('Employee Identity')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Phone: +63 960 431 6867' })).toHaveAttribute(
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
  await screen.findByText(
    (_, element) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim() ===
      'Privacy notice: Data Privacy Act of 2012',
    { selector: 'summary' },
  );
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
      ? Promise.resolve({
          result: {
            ...record,
            kind: 'OST',
            expiresOn: '2027-10-21',
            photoUrl: 'https://example.invalid/photo.jpg',
          },
          contactReceipt: 'receipt',
        })
      : defaults(path, ...args),
  );
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  const identity = within(await screen.findByRole('group', { name: 'Seller identity' }));
  expect(identity.getByRole('heading', { name: record.maskedName })).toBeInTheDocument();
  expect(identity.getByText(record.aaNumber)).toBeInTheDocument();
  expect(screen.getByText('Verification Status')).toBeInTheDocument();
  expect(screen.getByText('Accredited')).toBeInTheDocument();
  expect(screen.queryByText('2027-10-21')).not.toBeInTheDocument();
  // Photo click opens dialog
  const photoButton = screen.getByRole('button', { name: 'Enlarge profile photo' });
  await userEvent.click(photoButton);
  expect(screen.getByRole('dialog', { name: 'Profile photo' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Profile photo' })).not.toBeInTheDocument();
});

it('uses edited public support and bank settings in the approved result layout', async () => {
  const defaults = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (path: string, ...args) => {
    const data = await defaults(path, ...args);
    return path.endsWith('/config')
      ? {
          ...data,
          supportHeading: 'Member Payment Assistance',
          supportEmail: 'support@example.invalid',
          supportPhone: '+639171234568',
          bankHolder: 'Updated Company Holder',
          bank1Name: 'Updated Bank',
          bank1Account: '00112233',
          bank2Account: '00445566',
          checkPayee: 'Updated Check Payee',
          bankReminder: 'Confirm the account before paying.',
          agentReminder: 'Please pay the company directly.',
        }
      : data;
  });
  renderWithProviders(<SaleTeamSearch />);
  await begin();
  await acknowledge();
  await enterContact();
  const result = within(await screen.findByRole('article', { name: 'Verified sales team member' }));
  expect(result.getByRole('heading', { name: 'Member Payment Assistance' })).toBeInTheDocument();
  expect(result.getByRole('link', { name: 'Email: support@example.invalid' })).toHaveAttribute(
    'href',
    'mailto:support@example.invalid',
  );
  expect(result.getByRole('link', { name: 'Phone: +639171234568' })).toHaveAttribute(
    'href',
    'tel:+639171234568',
  );
  for (const text of [
    'Updated Company Holder',
    'Updated Bank',
    '00112233',
    '00445566',
    'Updated Check Payee',
    'Confirm the account before paying.',
    'Please pay the company directly.',
  ])
    expect(result.getByText(text)).toBeInTheDocument();
  expect(result.queryByRole('img', { name: 'SECURITY BANK' })).not.toBeInTheDocument();
  expect(result.getByRole('button', { name: `Copy ID ${record.aaNumber}` })).toBeInTheDocument();
});
