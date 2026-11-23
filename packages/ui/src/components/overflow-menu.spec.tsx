import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OverflowMenu } from '../index';

const ITEMS = [
  { label: 'Issue activation link', onClick: vi.fn() },
  { label: 'Deactivate account', danger: true, onClick: vi.fn() },
  { label: '-', onClick: undefined },
  { label: 'Delete permanently', danger: true, onClick: vi.fn() },
];

function openMenu() {
  render(<OverflowMenu label="More actions for CUS-1" items={ITEMS} />);
  return userEvent.setup();
}

describe('OverflowMenu', () => {
  it('shows only the trigger until opened', () => {
    render(<OverflowMenu label="More actions for CUS-1" items={ITEMS} />);
    expect(
      screen.getByRole('button', { name: 'More actions for CUS-1' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on trigger, acts on item click, and marks danger distinctly', async () => {
    const user = openMenu();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-1' }));
    const menu = screen.getByRole('menu', { name: 'More actions for CUS-1' });
    expect(menu).toBeInTheDocument();
    const deactivate = screen.getByRole('menuitem', { name: 'Deactivate account' });
    const issue = screen.getByRole('menuitem', { name: 'Issue activation link' });
    expect(deactivate.className).not.toBe(issue.className);
    await user.click(deactivate);
    expect(ITEMS[1]?.onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = openMenu();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-1' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for CUS-1' })).toHaveFocus();
  });

  it('moves keyboard focus into the menu on open', async () => {
    const user = openMenu();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Issue activation link' })).toHaveFocus();
  });

  it('renders disabled items as non-activatable', async () => {
    const action = vi.fn();
    render(
      <OverflowMenu
        label="Row actions"
        items={[{ label: 'Deactivate account', danger: true, disabled: true, onClick: action }]}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    const item = screen.getByRole('menuitem', { name: 'Deactivate account' });
    expect(item).toBeDisabled();
    await user.click(item).catch(() => {});
    expect(action).not.toHaveBeenCalled();
  });

  it('closes on scroll so the fixed panel never drifts from its row', async () => {
    const user = openMenu();
    await user.click(screen.getByRole('button', { name: 'More actions for CUS-1' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
