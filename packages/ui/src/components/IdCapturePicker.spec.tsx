import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IdCapturePicker } from './IdCapturePicker';

describe('ID capture browser invocation', () => {
  it('opens the secure file picker and passes the selected file', () => {
    const onFile = vi.fn();
    render(<IdCapturePicker onFile={onFile} />);
    const input = screen.getByLabelText('Upload ID');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload an ID' }));
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['synthetic ID'], 'qa-id.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  });
  it('requests the rear camera through the supported native capture attributes', () => {
    render(<IdCapturePicker onFile={vi.fn()} />);
    const input = screen.getByLabelText('Scan / Take Photo');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(click).toHaveBeenCalledOnce();
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'environment');
  });
  it('keeps both capture actions unavailable before a persisted subject exists', () => {
    render(<IdCapturePicker disabled onFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Upload an ID' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeDisabled();
  });
});
