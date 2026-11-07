import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccreditationId } from './AccreditationId';
afterEach(() => vi.unstubAllGlobals());
it.each(['AAI26100001', 'AAO26100002', 'AA-K7Q2M9T4B1R8'])(
  'copies the exact saved value %s',
  async (value) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const parent = vi.fn();
    render(
      <div onClick={parent} onKeyDown={parent}>
        <AccreditationId value={value} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Copy ID ' + value });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.click(button);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(value);
    expect(parent).not.toHaveBeenCalled();
    expect(screen.queryByText(/Legacy ID/i)).not.toBeInTheDocument();
  },
);
it('renders confirmed absence without a copy action', () => {
  render(<AccreditationId value={null} />);
  expect(screen.getByText('Not Yet Issued')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('does not turn unavailable data into a claim that no ID was issued', () => {
  render(<AccreditationId value={undefined} />);
  expect(screen.getByText('AA number unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Not Yet Issued')).not.toBeInTheDocument();
});
it('handles denied clipboard permission while keeping the saved ID readable', async () => {
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  render(<AccreditationId value="AAO26100002" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByText('Could not copy. Select and copy the ID.')).toBeInTheDocument();
  expect(screen.getByText('AAO26100002')).toBeInTheDocument();
});
