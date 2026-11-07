import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Dialog } from '../components/Dialog';
import { StrictMode } from 'react';

it('releases scroll locks only after the last dialog closes, including out-of-order dismissal', () => {
  document.body.style.overflow = 'auto';
  const dialogs = (first: boolean, second: boolean) => (
    <>
      <Dialog open={first} onClose={() => {}} title="First">
        First form
      </Dialog>
      <Dialog open={second} onClose={() => {}} title="Second">
        Second form
      </Dialog>
    </>
  );
  const view = render(dialogs(true, true));
  expect(document.body.style.overflow).toBe('hidden');
  view.rerender(dialogs(false, true));
  expect(document.body.style.overflow).toBe('hidden');
  view.rerender(dialogs(false, false));
  expect(document.body.style.overflow).toBe('auto');
  document.body.style.overflow = '';
});

it('restores pre-existing overflow after StrictMode unmount', () => {
  document.body.style.overflow = 'scroll';
  const view = render(
    <StrictMode>
      <Dialog open onClose={() => {}} title="Form">
        Form
      </Dialog>
    </StrictMode>,
  );
  expect(document.body.style.overflow).toBe('hidden');
  view.unmount();
  expect(document.body.style.overflow).toBe('scroll');
  document.body.style.overflow = '';
});
