import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';

import { LoginPage } from './LoginPage';
import { mockFetchRoutes, renderWithProviders } from '../../../test/utils';
import { normalizeRole } from '@jad/contracts';

// This file covers regression cases that are testable in vitest (MODE='test' → mock path).
// Supabase-authoritative branches are covered by session.regression.spec (which directly exercises SupabaseSessionProvider
// with mocked Supabase client, bypassing the MODE='test' guard). The important guarantee here is that mock auth still
// works when Supabase is not configured, and that error handling does not silently swallow failures.

describe('LoginPage regression - mock fallback preservation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('Supabase NOT configured → mock authentication continues (existing behavior) - user', async () => {
    const SESSION_USER = {
      id: 'mem-001',
      name: 'Juan Dela Cruz',
      email: 'juan.delacruz@example.com',
      role: 'user',
      isQualified: true,
      status: 'APPROVED_ACTIVE',
    };
    const fetchMock = mockFetchRoutes({ '/auth/login': { user: SESSION_USER } });
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
    const authCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) =>
      String(url).includes('/auth/login'),
    );
    expect(authCalls).toHaveLength(1);
  });

  it('Supabase NOT configured → mock admin still redirects to Admin App via VITE_ADMIN_URL (cross-app)', async () => {
    const ADMIN_USER = {
      id: 'sup-001',
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
  });

  it('surfaces API error envelope on failed credentials (no silent fallback)', async () => {
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
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.type(screen.getByLabelText('Email or phone number'), 'juan.delacruz@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  });

  it('unknown role normalizes to user (no escalation)', () => {
    expect(normalizeRole('unknown_role')).toBe('user');
    expect(normalizeRole('ADMIN')).toBe('admin');
    expect(normalizeRole('finance')).toBe('user');
    expect(normalizeRole('super_admin')).toBe('admin');
    expect(normalizeRole('SUPER-ADMIN')).toBe('admin');
    expect(normalizeRole('member')).toBe('user');
    expect(normalizeRole('MEMBER')).toBe('user');
    expect(normalizeRole('')).toBe('user');
    expect(normalizeRole(null)).toBe('user');
    expect(normalizeRole(undefined)).toBe('user');
  });

  it('members lookup failure is observable via error UI, not silent mock', async () => {
    mockFetchRoutes({
      '/auth/login': {
        body: {
          error: {
            code: 'INTERNAL',
            message: 'An unexpected error occurred.',
            timestamp: '2026-08-20T10:00:00Z',
          },
        },
        status: 500,
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.type(screen.getByLabelText('Email or phone number'), 'superadmin@gmail.com');
    await user.type(screen.getByLabelText('Password'), 'P@ssword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('An unexpected error occurred.')).toBeInTheDocument();
  });
});
