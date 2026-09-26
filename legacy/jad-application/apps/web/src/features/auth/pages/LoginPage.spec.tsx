import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';

import { LoginPage } from './LoginPage';
import { mockFetchRoutes, renderWithProviders } from '../../../test/utils';

const SESSION_USER = {
  id: 'mem-001',
  name: 'Juan Dela Cruz',
  email: 'juan.delacruz@example.com',
  role: 'user',
  isQualified: true,
  status: 'APPROVED_ACTIVE',
};

function renderLogin() {
  return renderWithProviders(<LoginPage />, { route: '/login' });
}

describe('LoginPage', () => {
  it('renders the login experience with all required controls', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email or phone number')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create your account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.queryByText('Development preview')).not.toBeInTheDocument();
  });

  it('validates required fields on submit and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Enter your email address or phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email or phone number')).toHaveFocus();
  });

  it('validates the identifier format (email or phone)', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email or phone number'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Enter a valid email address or phone number.')).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible show/hide button', async () => {
    const user = userEvent.setup();
    renderLogin();

    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));

    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    expect(input.type).toBe('text');
  });

  it('posts the credentials on submit and routes to the member area on success (user → Member App)', async () => {
    const fetchFn = mockFetchRoutes({ '/auth/login': { user: SESSION_USER } });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/member" element={<div>Member home</div>} />
      </Routes>,
      { route: '/login' },
    );

    await user.type(screen.getByLabelText('Email or phone number'), 'juan.delacruz@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Member home')).toBeInTheDocument();
    const authCall = fetchFn.mock.calls.find(([url]) => String(url).includes('/auth/login')) as
      [RequestInfo, RequestInit] | undefined;
    expect(authCall).toBeDefined();
    const [input, init] = authCall!;
    expect(String(input)).toMatch(/\/auth\/login$/);
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: 'juan.delacruz@example.com',
      password: 'password123',
    });
  });

  it('surfaces the API error envelope on failed credentials', async () => {
    mockFetchRoutes({
      '/auth/login': {
        body: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Email or password is incorrect.',
            timestamp: '2026-08-20T10:00:00Z',
          },
        },
        status: 401,
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Email or phone number'), 'juan.delacruz@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(screen.getByText('We could not sign you in')).toBeInTheDocument();
  });

  it('redirects admin to Admin App via VITE_ADMIN_URL (cross-app, not member route)', async () => {
    const ADMIN_USER = {
      id: 'adm-001',
      name: 'Admin',
      email: 'admin@jad.local',
      role: 'admin',
      isQualified: true,
      status: 'APPROVED_ACTIVE',
    };
    mockFetchRoutes({ '/auth/login': { user: ADMIN_USER } });
    const user = userEvent.setup();
    const originalLocation = window.location;
    let hrefValue = originalLocation.href;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        get href() {
          return hrefValue;
        },
        set href(v: string) {
          hrefValue = v;
        },
      } as unknown as Location,
    });

    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/member" element={<div>Member home</div>} />
      </Routes>,
      { route: '/login' },
    );

    await user.type(screen.getByLabelText('Email or phone number'), 'admin@jad.local');
    await user.type(screen.getByLabelText('Password'), 'Admin123!Local');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(hrefValue).toMatch(/5174/);
    expect(hrefValue).toMatch(/\/admin/);

    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });

    vi.restoreAllMocks();
  });

  it('links Terms and Privacy Policy to the canonical policy routes', async () => {
    const fetchFn = mockFetchRoutes({
      '/policies': {
        data: [
          {
            id: 'pol-001',
            slug: 'terms',
            title: 'Terms and Conditions',
            type: 'terms',
            content: 'Terms copy.',
            updatedAt: '2026-08-18T10:00:00.000Z',
          },
          {
            id: 'pol-003',
            slug: 'privacy',
            title: 'Privacy Policy',
            type: 'privacy',
            content: 'Privacy copy.',
            updatedAt: '2026-08-18T10:00:00.000Z',
          },
        ],
      },
    });
    renderLogin();

    // Wait for the mocked policies response to drive the note (the static
    // fallback renders the same slugs while the query is pending).
    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining('/policies'),
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/policies/terms',
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/policies/privacy',
    );
  });

  it('renders Privacy Policy as plain text when no privacy policy exists', async () => {
    mockFetchRoutes({
      '/policies': {
        data: [
          {
            id: 'pol-001',
            slug: 'terms',
            title: 'Terms and Conditions',
            type: 'terms',
            content: 'Terms copy.',
            updatedAt: '2026-08-18T10:00:00.000Z',
          },
        ],
      },
    });
    renderLogin();

    expect(await screen.findByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/policies/terms',
    );
    // The fallback renders the link while the query is pending - wait for the
    // terms-only response to settle before asserting the plain-text fallback.
    const note = await screen.findByText(/Secure sign-in/);
    await waitFor(() =>
      expect(
        within(note).queryByRole('link', { name: 'Privacy Policy' }),
      ).not.toBeInTheDocument(),
    );
    expect(note.textContent).toContain('Privacy Policy');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
