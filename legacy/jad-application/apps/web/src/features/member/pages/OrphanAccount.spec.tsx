import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { mockFetchRoutes } from '../../../test/utils';
import { renderMember } from '../test/utils';
import { MyGenealogyPage } from './MyGenealogyPage';
import { ProfilePage } from './ProfilePage';

const ORPHAN_BODY = {
  error: {
    code: 'NOT_FOUND',
    message: 'Member not found',
    requestId: 'test-orphan',
    timestamp: '2026-09-11T00:00:00Z',
  },
};

describe('orphaned member account (Member row deleted)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('genealogy shows the friendly account message instead of the raw envelope', async () => {
    mockFetchRoutes({ '/me/genealogy': { body: ORPHAN_BODY, status: 404 } });
    renderMember(<MyGenealogyPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/account no longer exists/i)).toBeInTheDocument();
  });

  it('profile shows the friendly account message instead of the raw envelope', async () => {
    mockFetchRoutes({ '/members/mem-001': { body: ORPHAN_BODY, status: 404 } });
    renderMember(<ProfilePage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/account no longer exists/i)).toBeInTheDocument();
  });
});
