import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { TextField } from './TextField.js';

afterEach(cleanup);
function Form({ initial = '', uppercase = true }: { initial?: string; uppercase?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <TextField
      id="name"
      name="name"
      label="Name"
      value={value}
      onChange={setValue}
      normalize={uppercase ? (v) => v.toUpperCase() : undefined}
    />
  );
}
function setup(initial = '', uppercase = true) {
  render(<Form initial={initial} uppercase={uppercase} />);
  const input = screen.getByLabelText<HTMLInputElement>('Name');
  input.focus();
  return { input, user: userEvent.setup() };
}
it('uppercases typing at the end', async () => {
  const { input, user } = setup();
  await user.type(input, 'claud mars jimenez');
  expect(input.value).toBe('CLAUD MARS JIMENEZ');
  expect(input.selectionStart).toBe(18);
});
it('preserves the exact mid-name caret', async () => {
  const { input, user } = setup('CLAUD MARS JIMENEZ');
  input.setSelectionRange(2, 2);
  await user.keyboard('x');
  expect(input.value).toBe('CLXAUD MARS JIMENEZ');
  expect(input.selectionStart).toBe(3);
  expect(input.selectionEnd).toBe(3);
});
it('keeps the second inserted character in the middle', async () => {
  const { input, user } = setup('CLAUD MARS JIMENEZ');
  input.setSelectionRange(2, 2);
  await user.keyboard('xy');
  expect(input.value).toBe('CLXYAUD MARS JIMENEZ');
  expect(input.selectionStart).toBe(4);
});
it('preserves backspace position', async () => {
  const { input, user } = setup('CLAUD');
  input.setSelectionRange(3, 3);
  await user.keyboard('{Backspace}');
  expect(input.value).toBe('CLUD');
  expect(input.selectionStart).toBe(2);
});
it('preserves Delete position', async () => {
  const { input, user } = setup('CLAUD');
  input.setSelectionRange(2, 2);
  await user.keyboard('{Delete}');
  expect(input.value).toBe('CLUD');
  expect(input.selectionStart).toBe(2);
});
it('replaces a selected name', async () => {
  const { input, user } = setup('CLAUD MARS JIMENEZ');
  input.setSelectionRange(6, 10);
  await user.keyboard('juan');
  expect(input.value).toBe('CLAUD JUAN JIMENEZ');
  expect(input.selectionStart).toBe(10);
});
it('pastes in the middle', async () => {
  const { input, user } = setup('CLAUD');
  input.setSelectionRange(2, 2);
  await user.paste('xy');
  expect(input.value).toBe('CLXYAUD');
  expect(input.selectionStart).toBe(4);
});
it('maps Unicode expansion through the prefix', async () => {
  const { input, user } = setup('CLAUD');
  input.setSelectionRange(2, 2);
  await user.keyboard('ß');
  expect(input.value).toBe('CLSSAUD');
  expect(input.selectionStart).toBe(4);
});
it('keeps apostrophes', async () => {
  const { input, user } = setup();
  await user.type(input, "o'neil");
  expect(input.value).toBe("O'NEIL");
});
it('keeps hyphens', async () => {
  const { input, user } = setup();
  await user.type(input, 'anne-marie');
  expect(input.value).toBe('ANNE-MARIE');
});
it('edits an address in the middle', async () => {
  const { input, user } = setup('12 MAIN ROAD');
  input.setSelectionRange(3, 3);
  await user.keyboard('new ');
  expect(input.value).toBe('12 NEW MAIN ROAD');
  expect(input.selectionStart).toBe(7);
});
it('edits an initially empty optional value', async () => {
  const { input, user } = setup();
  await user.type(input, 'mars');
  input.setSelectionRange(1, 1);
  await user.keyboard('x');
  expect(input.value).toBe('MXARS');
  expect(input.selectionStart).toBe(2);
});
it('leaves excluded email casing unchanged', async () => {
  const { input, user } = setup('', false);
  await user.type(input, 'Qa.User@example.com');
  expect(input.value).toBe('Qa.User@example.com');
});
it('preserves an IME draft and normalizes the completed composition', () => {
  const { input } = setup('AB');
  input.setSelectionRange(1, 1);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'AßB', selectionStart: 2, selectionEnd: 2 } });
  expect(input.value).toBe('AßB');
  fireEvent.compositionEnd(input, { data: 'ß' });
  expect(input.value).toBe('ASSB');
  expect(input.selectionStart).toBe(3);
});
