import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhoneField } from './PhoneField';
import type { CountryPhoneMeta } from '../registrationValidation';

const COUNTRIES: CountryPhoneMeta[] = [
  {
    code: 'PH',
    name: 'Philippines',
    dialCode: '63',
    phoneMin: 10,
    phoneMax: 10,
    phonePattern: '^9[0-9]{9}$',
  },
  { code: 'US', name: 'United States', dialCode: '1', phoneMin: 10, phoneMax: 10 },
];

function renderField(overrides?: Partial<React.ComponentProps<typeof PhoneField>>) {
  const onDialChange = vi.fn();
  const onNationalChange = vi.fn();
  render(
    <PhoneField
      dial="63"
      national=""
      countries={COUNTRIES}
      onDialChange={onDialChange}
      onNationalChange={onNationalChange}
      {...overrides}
    />,
  );
  return { onDialChange, onNationalChange };
}

describe('PhoneField', () => {
  it('lists country-code options from config metadata', () => {
    renderField();
    expect(screen.getByLabelText('Country code')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '+63 Philippines' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '+1 United States' })).toBeInTheDocument();
  });

  it('caps the input at the selected country limit while typing', () => {
    const { onNationalChange } = renderField();
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '9185550101999' },
    });
    expect(onNationalChange).toHaveBeenCalledWith('9185550101');
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('maxLength', '10');
  });

  it('restricts pasted values to the limit the same way', () => {
    const { onNationalChange } = renderField();
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+63 917 555 0999' },
    });
    expect(onNationalChange).toHaveBeenCalledWith('9175550999');
  });

  it('strips non-numeric characters instead of accepting them', () => {
    const { onNationalChange } = renderField();
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '918-CALL-ME' },
    });
    expect(onNationalChange).toHaveBeenCalledWith('918');
  });

  it('updates the allowed length immediately when the country code changes', () => {
    const { container, onDialChange, rerender } = (() => {
      const onDialChange = vi.fn();
      const onNationalChange = vi.fn();
      const rendered = render(
        <PhoneField
          dial="63"
          national=""
          countries={COUNTRIES}
          onDialChange={onDialChange}
          onNationalChange={onNationalChange}
        />,
      );
      return { container: rendered.container, onDialChange, rerender: rendered.rerender };
    })();
    expect(container).toBeInTheDocument();
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('maxLength', '10');

    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '1' } });
    expect(onDialChange).toHaveBeenCalledWith('1');

    rerender(
      <PhoneField
        dial="1"
        national=""
        countries={COUNTRIES}
        onDialChange={vi.fn()}
        onNationalChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Phone number')).toHaveAttribute('maxLength', '10');
    expect(screen.getByText('+1 - 10 digits.')).toBeInTheDocument();
  });

  it('shows the digit hint and surfaces the error in its place', () => {
    const { rerender } = (() => {
      const rendered = render(
        <PhoneField
          dial="63"
          national=""
          countries={COUNTRIES}
          onDialChange={vi.fn()}
          onNationalChange={vi.fn()}
        />,
      );
      return { rerender: rendered.rerender };
    })();
    expect(screen.getByText('+63 - 10 digits.')).toBeInTheDocument();

    rerender(
      <PhoneField
        dial="63"
        national="123"
        countries={COUNTRIES}
        error="Enter a valid phone number."
        onDialChange={vi.fn()}
        onNationalChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone number.');
    expect(screen.queryByText('+63 - 10 digits.')).not.toBeInTheDocument();
  });
});
