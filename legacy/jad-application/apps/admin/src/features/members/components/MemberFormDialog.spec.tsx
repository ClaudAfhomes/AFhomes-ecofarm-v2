import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '../../../test/utils';
import { MemberFormDialog } from './MemberFormDialog';

describe('MemberFormDialog', () => {
  it('form container is width-responsive (no fixed 320px floor that overflows phones)', () => {
    renderWithProviders(<MemberFormDialog open onClose={() => {}} member={null} />);
    const fields = screen.getByTestId('member-form-fields');
    const minWidth = fields.style.minWidth;
    // A hard "320px" floor overflows viewports narrower than ~352px (320 +
    // dialog padding). The minimum must scale with the viewport instead.
    expect(minWidth).not.toBe('320px');
    expect(minWidth).toMatch(/min\(|max-width|%/);
  });
});
