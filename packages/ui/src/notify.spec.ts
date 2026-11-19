import { beforeEach, describe, expect, it, vi } from 'vitest';

import Swal from 'sweetalert2';

import { notifyConfirm, notifyError, notifySuccess, notifyWarning } from './notify.js';

vi.mock('sweetalert2', () => ({
  default: { fire: vi.fn(() => Promise.resolve({ isConfirmed: false })) },
}));

const fire = Swal.fire as unknown as ReturnType<typeof vi.fn>;

describe('notify', () => {
  beforeEach(() => {
    fire.mockClear();
  });

  it('shows a centered auto-dismissing success modal (not a toast)', () => {
    notifySuccess({ title: 'Policy updated', message: 'Saved.' });
    expect(fire).toHaveBeenCalledTimes(1);
    const [config] = fire.mock.calls[0] as [Record<string, unknown>];
    expect(config.toast).not.toBe(true);
    expect(config.icon).toBe('success');
    expect(config.title).toBe('Policy updated');
    expect(config.text).toBe('Saved.');
    expect(config.showConfirmButton).toBe(false);
    expect(typeof config.timer).toBe('number');
    expect(config.backdrop).toBe(true);
    expect(config.allowOutsideClick).toBe(false);
  });

  it('shows a blocking error modal', () => {
    notifyError({ title: 'Delete failed' });
    const [config] = fire.mock.calls[0] as [Record<string, unknown>];
    expect(config.icon).toBe('error');
    expect(config.title).toBe('Delete failed');
    expect(config.showConfirmButton).not.toBe(false);
    expect(config.backdrop).toBe(true);
    expect(config.allowOutsideClick).toBe(false);
  });

  it('shows a warning modal', () => {
    notifyWarning({ title: 'Auth user remains', message: 'details' });
    const [config] = fire.mock.calls[0] as [Record<string, unknown>];
    expect(config.icon).toBe('warning');
    expect(config.title).toBe('Auth user remains');
    expect(config.backdrop).toBe(true);
    expect(config.allowOutsideClick).toBe(false);
  });

  describe('notifyConfirm', () => {
    it('resolves true only on an explicit confirmation', async () => {
      fire.mockResolvedValueOnce({ isConfirmed: true });
      await expect(notifyConfirm({ title: 'Record?', confirmButtonText: 'Record' })).resolves.toBe(
        true,
      );
      const [config] = fire.mock.calls[0] as [Record<string, unknown>];
      expect(config.showCancelButton).toBe(true);
      expect(config.confirmButtonText).toBe('Record');
      expect(config.cancelButtonText).toBe('Cancel');
      expect(config.allowOutsideClick).toBe(false);
    });

    it('resolves false when the operator cancels or dismisses', async () => {
      fire.mockResolvedValueOnce({ isConfirmed: false });
      await expect(
        notifyConfirm({ title: 'Record?', confirmButtonText: 'Record' }),
      ).resolves.toBe(false);
    });
  });

  describe('detail lines', () => {
    it('escapes interpolated detail so server values cannot inject markup', () => {
      notifySuccess({
        title: 'Payment recorded',
        message: 'Saved.',
        detail: 'Ref <script>alert(1)</script>\nAmount 1,000.00',
      });
      const [config] = fire.mock.calls[0] as [Record<string, unknown>];
      expect(config.html).toContain('&lt;script&gt;');
      expect(config.html).not.toContain('<script>');
      expect(config.html).toContain('Ref &lt;script&gt;alert(1)&lt;/script&gt;');
      expect(config.text).toBeUndefined();
    });

    it('leaves text alone when no detail is supplied', () => {
      notifySuccess({ title: 'Policy updated', message: 'Saved.' });
      const [config] = fire.mock.calls[0] as [Record<string, unknown>];
      expect(config.text).toBe('Saved.');
      expect(config.html).toBeUndefined();
    });
  });
});
