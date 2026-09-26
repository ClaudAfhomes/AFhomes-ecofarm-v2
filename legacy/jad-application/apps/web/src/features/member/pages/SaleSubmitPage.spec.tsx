import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MOCK_MEMBER } from '@jad/mock';

import { SaleSubmitPage } from './SaleSubmitPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CUSTOMERS = {
  data: [{ id: 'cus-001', fullName: 'Ramon Reyes', phone: '+63 917 555 0111' }],
  meta: {},
};

const DIRECT_REFERRALS = {
  data: [
    {
      id: 'mem-002',
      name: 'Maria Santos',
      status: 'APPROVED_ACTIVE',
      isQualified: true,
      joinedAt: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'mem-003',
      name: 'Pedro Pendiente',
      status: 'PENDING',
      isQualified: false,
      joinedAt: '2026-07-05T00:00:00.000Z',
    },
  ],
  meta: {},
};

const SALE_RESPONSE = {
  id: 'sal-011',
  status: 'SUBMITTED',
  propertyId: 'igp-250-sqm-farm-lot',
  propertyName: '250 SQM Farm Lot with Hotspring',
  propertyValue: '1200000.00',
  customerId: 'cus-001',
  customerName: 'Ramon Reyes',
  sellerId: 'mem-001',
  sellerName: 'Juan Dela Cruz',
  resubmissionCount: 0,
  submittedAt: '2026-08-20T10:00:00.000Z',
};

function SaleDetailProbe() {
  return <div>sale detail page</div>;
}

function renderSubmit() {
  return renderMember(
    <Routes>
      <Route path="/member/sales/new" element={<SaleSubmitPage />} />
      <Route path="/member/sales/:saleId" element={<SaleDetailProbe />} />
    </Routes>,
    { route: '/member/sales/new', user: MOCK_MEMBER },
  );
}

describe('member SaleSubmitPage (SCR-MEM-006, FR-SAL-002)', () => {
  it('renders the customer and catalog property pickers', async () => {
    mockFetchRoutes({ '/customers': CUSTOMERS });
    renderSubmit();

    await screen.findByLabelText('Customer');
    expect(screen.getByLabelText('Catalog property')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit sale' })).toBeInTheDocument();
    expect(
      screen.getByLabelText('Customer').querySelector('option[value="cus-001"]'),
    ).not.toBeNull();
  });

  it('validates required selections before submitting', async () => {
    mockFetchRoutes({ '/customers': CUSTOMERS });
    const user = userEvent.setup();
    renderSubmit();

    await screen.findByLabelText('Customer');
    await user.click(screen.getByRole('button', { name: 'Submit sale' }));

    expect(screen.getByText('Select a customer or add a new one.')).toBeInTheDocument();
    expect(screen.getByText('Select a property from the catalog.')).toBeInTheDocument();
  });

  it('submits a sale with an existing customer and navigates to the new sale', async () => {
    mockFetchRoutes({ '/customers': CUSTOMERS, '/sales': SALE_RESPONSE });
    const user = userEvent.setup();
    renderSubmit();

    await screen.findByLabelText('Customer');
    await user.selectOptions(screen.getByLabelText('Customer'), 'cus-001');
    await user.selectOptions(screen.getByLabelText('Catalog property'), 'igp-250-sqm-farm-lot');
    await user.click(screen.getByRole('button', { name: 'Submit sale' }));

    expect(await screen.findByText('sale detail page')).toBeInTheDocument();
  });

  it('surfaces the API envelope error when the submission is rejected', async () => {
    mockFetchRoutes({
      '/customers': CUSTOMERS,
      '/sales': {
        body: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Select a customer and a property from the catalog.',
            timestamp: '2026-08-20T10:00:00Z',
          },
        },
        status: 400,
      },
    });
    const user = userEvent.setup();
    renderSubmit();

    await screen.findByLabelText('Customer');
    await user.selectOptions(screen.getByLabelText('Customer'), 'cus-001');
    await user.selectOptions(screen.getByLabelText('Catalog property'), 'igp-250-sqm-farm-lot');
    await user.click(screen.getByRole('button', { name: 'Submit sale' }));

    expect(
      await screen.findByText('Select a customer and a property from the catalog.'),
    ).toBeInTheDocument();
  });

  it('shows a network error state when customers cannot load', async () => {
    mockFetchNetworkError();
    renderSubmit();

    expect(await screen.findByText('Could not load your customers')).toBeInTheDocument();
  });

  it('lists the member\u2019s direct referrals in the referrer dropdown', async () => {
    mockFetchRoutes({ '/customers': CUSTOMERS, '/me/direct-referrals': DIRECT_REFERRALS });
    renderSubmit();

    await screen.findByLabelText('Customer');
    const referrer = screen.getByRole('combobox', { name: /Referrer/ });
    expect(referrer.querySelector('option[value="mem-002"]')).not.toBeNull();
    expect(referrer.querySelector('option[value="mem-003"]')).not.toBeNull();
  });

  it('submits a selected direct referral as the referrer', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/customers')) return Promise.resolve(json(CUSTOMERS));
      if (url.endsWith('/me/direct-referrals')) return Promise.resolve(json(DIRECT_REFERRALS));
      if (url.endsWith('/sales') && method === 'POST') return Promise.resolve(json(SALE_RESPONSE));
      return Promise.resolve(json({ data: [], meta: {} }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderSubmit();

    await screen.findByLabelText('Customer');
    await user.selectOptions(screen.getByLabelText('Customer'), 'cus-001');
    await user.selectOptions(screen.getByLabelText('Catalog property'), 'igp-250-sqm-farm-lot');
    await user.selectOptions(screen.getByRole('combobox', { name: /Referrer/ }), 'mem-002');
    await user.click(screen.getByRole('button', { name: 'Submit sale' }));

    await screen.findByText('sale detail page');
    const createCall = fetchMock.mock.calls.find(
      (call) =>
        String(call[0]).endsWith('/sales') &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String((createCall?.[1] as RequestInit | undefined)?.body));
    expect(body.referrerId).toBe('mem-002');
  });
});
