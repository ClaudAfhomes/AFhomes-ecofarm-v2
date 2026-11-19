import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@afhomes/ui';
import { useCmsUnsaved } from './useCmsUnsaved';

function Editor({ dirty, navigate }: { dirty: boolean; navigate: () => void }) {
  const guard = useCmsUnsaved(dirty);
  return (
    <>
      <a
        href="/admin/cms/pages"
        onClick={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        Other page
      </a>
      <a
        href="/admin/cms/pages"
        target="_blank"
        onClick={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        New tab
      </a>
      <ConfirmDialog
        {...guard}
        title="Leave this editor?"
        message="Your unsaved changes will be lost."
        confirmLabel="Leave editor"
      />
    </>
  );
}

it('preserves edits on cancel and navigates once after explicit confirmation', async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  render(<Editor dirty navigate={navigate} />);
  await user.click(screen.getByRole('link', { name: 'Other page' }));
  expect(navigate).not.toHaveBeenCalled();
  expect(await screen.findByRole('dialog', { name: 'Leave this editor?' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'Other page' }));
  await user.click(screen.getByRole('button', { name: 'Leave editor' }));
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('lets clean editors, modifier clicks and new tabs navigate without a discard prompt', () => {
  const navigate = vi.fn();
  const view = render(<Editor dirty navigate={navigate} />);
  fireEvent.click(screen.getByRole('link', { name: 'Other page' }), { ctrlKey: true });
  fireEvent.click(screen.getByRole('link', { name: 'New tab' }));
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.rerender(<Editor dirty={false} navigate={navigate} />);
  fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
  expect(navigate).toHaveBeenCalledTimes(3);
});

it('keeps the unload warning while dirty and removes listeners after unmount', () => {
  const navigate = vi.fn();
  const view = render(<Editor dirty navigate={navigate} />);
  const dirtyUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirtyUnload);
  expect(dirtyUnload.defaultPrevented).toBe(true);
  view.unmount();
  const cleanUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});
