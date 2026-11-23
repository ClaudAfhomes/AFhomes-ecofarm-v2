import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton, SearchField, StatusChip, ErrorState, ConfirmDialog } from '../index';

describe('Canonical action controls', () => {
  it.each(['sm', 'md', 'lg'] as const)(
    'supports %s without dropping caller classes or submit type',
    (size) => {
      render(
        <Button size={size} type="submit" className="caller">
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button).toHaveAttribute('data-size', size);
      expect(button).toHaveAttribute('type', 'submit');
      expect(button.className).toContain('caller');
      expect(button.className).toContain('button');
    },
  );
  it.each(['primary', 'secondary', 'outline', 'ghost', 'danger'] as const)(
    'supports the %s variant',
    (variant) => {
      render(<Button variant={variant}>Action</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant);
    },
  );
  it('reserves the original label while announcing loading and blocks duplicate clicks', async () => {
    const click = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading loadingLabel="Saving…" onClick={click}>
        Save Changes
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByText('Save Changes')).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button'));
    expect(click).not.toHaveBeenCalled();
  });
  it('allows keyboard activation and names icon-only controls', async () => {
    const click = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon="close" label="Close details" onClick={click} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Close details');
  });
  it('clears search without submitting its containing form and returns focus', async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    function Search() {
      const [value, setValue] = useState('QA');
      return (
        <form onSubmit={submit}>
          <SearchField label="Find member" value={value} onChange={setValue} busy />
        </form>
      );
    }
    render(<Search />);
    expect(screen.getByRole('status')).toHaveTextContent('Updating results');
    await user.click(screen.getByRole('button', { name: 'Clear find member' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps disabled search read-only and does not offer a clear action', () => {
    render(<SearchField label="Search" value="QA" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('searchbox')).toBeDisabled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('renders a readable lifecycle label with a non-color indicator', () => {
    render(<StatusChip label="final_qualification_pending" />);
    const chip = screen.getByText('Final qualification pending');
    expect(chip.className).toContain('warning');
    expect(chip.querySelector('svg')).not.toBeNull();
  });
  it('keeps server details out of primary errors but exposes a support reference', () => {
    render(<ErrorState error={{ message: 'SQL secret', requestId: 'req-qa' }} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('SQL secret');
    expect(screen.getByText('Reference: req-qa').closest('details')).not.toHaveAttribute('open');
  });
  it('retains Escape and safe cancel while a destructive confirmation is open', async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        danger
        title="Deactivate this account?"
        message="They will no longer be able to log in."
        onCancel={cancel}
        onConfirm={confirm}
      />,
    );
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
});
