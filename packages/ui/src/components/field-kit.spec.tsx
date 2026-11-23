import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateField } from './DateField';
import { FileField } from './FileField';
import { Select } from './Select';
import { TextAreaField } from './TextAreaField';

describe('Select', () => {
  it('renders disabled options as disabled', () => {
    render(
      <Select
        aria-label="Category"
        value=""
        onChange={() => {}}
        options={[
          { value: '', label: 'Select a category' },
          { value: 'archived', label: 'Archived (inactive)', disabled: true },
        ]}
      />,
    );
    expect(screen.getByRole('option', { name: 'Select a category' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Archived (inactive)' })).toBeDisabled();
  });
});

describe('DateField', () => {
  it('associates the label and reports the picked date', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateField id="from" name="from" label="From" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('From'), '2026-01-15');
    expect(onChange).toHaveBeenLastCalledWith('2026-01-15');
  });

  it('is required by default so migrations must pass optional explicitly', () => {
    render(<DateField id="from" name="from" label="From" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('From')).toBeRequired();
  });

  it('drops the required flag when optional', () => {
    render(
      <DateField id="to" name="to" label="To" value="" optional onChange={() => {}} />,
    );
    expect(screen.getByLabelText('To(Optional)')).not.toBeRequired();
  });
});

describe('TextAreaField', () => {
  it('associates the label and reports edits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextAreaField id="notes" name="notes" label="Notes" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Notes'), 'hello');
    expect(onChange).toHaveBeenLastCalledWith('o');
  });

  it('wires an error message to the control', () => {
    render(
      <TextAreaField id="notes" name="notes" label="Notes" value="" onChange={() => {}} error="Required" />,
    );
    const field = screen.getByLabelText('Notes');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('is required by default so migrations must pass optional explicitly', () => {
    render(<TextAreaField id="a" name="a" label="A" value="" onChange={() => {}} />);
    expect(screen.getByLabelText('A')).toBeRequired();
  });

  it('drops the required flag when optional', () => {
    render(
      <TextAreaField id="b" name="b" label="B" value="" optional onChange={() => {}} />,
    );
    expect(screen.getByLabelText('B(Optional)')).not.toBeRequired();
  });
});

describe('FileField', () => {
  it('associates the label and reports the chosen file', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FileField id="scan" name="scan" label="Scan to upload" accept=".pdf" onSelect={onSelect} />,
    );
    const file = new File(['bytes'], 'scan.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Scan to upload'), file);
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('renders caller status under the control', () => {
    render(
      <FileField
        id="scan"
        name="scan"
        label="Scan to upload"
        onSelect={() => {}}
        status={<p>Selected: scan.pdf</p>}
      />,
    );
    expect(screen.getByText('Selected: scan.pdf')).toBeInTheDocument();
  });
});
