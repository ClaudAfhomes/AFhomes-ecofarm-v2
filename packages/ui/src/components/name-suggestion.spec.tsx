import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NormalizedInput } from './NormalizedInput';
afterEach(cleanup);
function Name({ initial = '' }: { initial?: string }) {
  const [name, setName] = useState(initial);
  return (
    <NormalizedInput
      aria-label="Name"
      suggestName
      value={name}
      onChange={(e) => setName(e.target.value)}
    />
  );
}
it('suggests ordinary lowercase names once on blur, including initials', () => {
  render(<Name />);
  const input = screen.getByLabelText('Name');
  fireEvent.change(input, { target: { value: 'claud mars c. jimenez' } });
  expect(input).toHaveValue('claud mars c. jimenez');
  fireEvent.blur(input);
  expect(input).toHaveValue('Claud Mars C. Jimenez');
  fireEvent.change(input, { target: { value: 'de la Cruz' } });
  fireEvent.blur(input);
  expect(input).toHaveValue('de la Cruz');
});
it.each(['McDonald', 'MacArthur', 'de la Cruz', 'van der Meer', "O'Connor", 'Anne-Marie', 'Peña'])(
  'preserves deliberately entered %s',
  (name) => {
    render(<Name initial={name} />);
    const input = screen.getByLabelText('Name');
    fireEvent.blur(input);
    expect(input).toHaveValue(name);
  },
);
