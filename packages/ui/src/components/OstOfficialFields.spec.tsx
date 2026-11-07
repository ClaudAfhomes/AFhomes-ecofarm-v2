import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GOVERNMENT_ID_TYPE_LABELS } from '@afhomes/contracts';
import { OstOfficialFields } from './OstOfficialFields';

describe('official OST identity categories', () => {
  it('offers the approved IST categories and passes their storage values', () => {
    const onChange = vi.fn();
    render(<OstOfficialFields values={{}} onChange={onChange} />);
    const field = screen.getByRole('combobox', { name: 'Government ID type' });
    expect(within(field).getAllByRole('option')).toHaveLength(6);
    for (const [value, label] of Object.entries(GOVERNMENT_ID_TYPE_LABELS)) {
      expect(within(field).getByRole('option', { name: label })).toHaveValue(value);
      fireEvent.change(field, { target: { value } });
      expect(onChange).toHaveBeenLastCalledWith('governmentIdType', value);
    }
  });
});
