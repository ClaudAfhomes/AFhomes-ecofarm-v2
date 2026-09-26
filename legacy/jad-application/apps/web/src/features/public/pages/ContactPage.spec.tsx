import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ContactPage } from './ContactPage';
import { mockFetchRoutes, renderWithProviders } from '../../../test/utils';

describe('ContactPage', () => {
  it('renders real contact methods and the message form', () => {
    renderWithProviders(<ContactPage />);

    expect(
      screen.getByRole('heading', { name: /talk with ja&d realty services/i }),
    ).toBeInTheDocument();

    const messenger = screen.getByRole('link', { name: /message us on messenger/i });
    expect(messenger).toHaveAttribute('href', 'https://m.me/JADRealtyServices');
    expect(messenger).toHaveAttribute('target', '_blank');
    expect(messenger).toHaveAttribute('rel', 'noopener noreferrer');

    const phone = screen.getByRole('link', { name: /0965-250-0052/i });
    expect(phone).toHaveAttribute('href', 'tel:+639652500052');

    const email = screen.getByRole('link', { name: /info\.jaandd@gmail\.com/i });
    expect(email).toHaveAttribute('href', 'mailto:info.jaandd@gmail.com');

    expect(screen.getByText(/alaminos commercial complex/i)).toBeInTheDocument();

    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeInTheDocument();
  });

  it('posts the inquiry and acknowledges a real 201', async () => {
    const fetchMock = mockFetchRoutes({
      '/contact': { id: 'inq-abc', createdAt: '2026-09-16T10:00:00.000Z' },
    });
    const user = userEvent.setup();
    renderWithProviders(<ContactPage />);

    await user.type(screen.getByLabelText('Name'), 'Maria Santos');
    await user.type(screen.getByLabelText('Email'), 'maria@example.com');
    await user.type(
      screen.getByLabelText('Message'),
      'I would like to know more about membership, thank you.',
    );
    await user.click(screen.getByRole('button', { name: 'Send Message' }));

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/contact') &&
        !String(url).endsWith('/cms/contact') &&
        (init as RequestInit)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    const [, init] = postCalls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: 'Maria Santos',
      email: 'maria@example.com',
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Thank you for reaching out.');
  });

  it('shows inline errors without submitting when fields are invalid', async () => {
    const fetchMock = mockFetchRoutes({});
    const user = userEvent.setup();
    renderWithProviders(<ContactPage />);

    await user.click(screen.getByRole('button', { name: 'Send Message' }));

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/contact') &&
        !String(url).endsWith('/cms/contact') &&
        (init as RequestInit)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Tell us a little more (at least 10 characters).')).toBeInTheDocument();
  });

  it('surfaces the server error when the API rejects the submission', async () => {
    mockFetchRoutes({
      '/contact': {
        body: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many messages sent recently.' } },
        status: 429,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<ContactPage />);

    await user.type(screen.getByLabelText('Name'), 'Maria Santos');
    await user.type(screen.getByLabelText('Email'), 'maria@example.com');
    await user.type(
      screen.getByLabelText('Message'),
      'I would like to know more about membership, thank you.',
    );
    await user.click(screen.getByRole('button', { name: 'Send Message' }));

    expect(await screen.findByText('Too many messages sent recently.')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
