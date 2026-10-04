import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HumanInput } from './HumanInput';
function Field({ type = 'text', name = false }: { type?: string; name?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <HumanInput
      aria-label="QA field"
      type={type}
      suggestName={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
it('shows accessible inline name errors only after interaction', () => {
  render(<Field name />);
  const field = screen.getByLabelText('QA field');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'Claud123' } });
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(document.getElementById(field.getAttribute('aria-describedby')!)).toHaveTextContent(
    'Names cannot contain numbers',
  );
  fireEvent.change(field, { target: { value: 'Claud' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('blocks phone letters, explains why, and accepts a valid PH number', () => {
  render(<Field type="tel" />);
  const field = screen.getByLabelText('QA field');
  fireEvent.change(field, { target: { value: '0917TEST' } });
  expect(field).toHaveValue('');
  expect(screen.getByRole('alert')).toHaveTextContent('Letters are not accepted');
  fireEvent.change(field, { target: { value: '0917 123 4567' } });
  expect(field).toHaveValue('0917 123 4567');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('updates email validation while editing', () => {
  render(<Field type="email" />);
  const field = screen.getByLabelText('QA field');
  fireEvent.change(field, { target: { value: 'claud@' } });
  expect(screen.getByRole('alert')).toHaveTextContent('valid email');
  fireEvent.change(field, { target: { value: 'claud@example.com' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
