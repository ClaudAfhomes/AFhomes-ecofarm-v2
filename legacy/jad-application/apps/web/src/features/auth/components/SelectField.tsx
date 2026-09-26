import { FormField } from './FormField';
import { fieldStyles } from './fieldStyles';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
}

/**
 * Native `<select>` for the auth forms (program/gender/country). Renders in the
 * shared `FormField` with the same input styling, `aria-invalid`/`aria-describedby`
 * wiring and required marking as `TextField` (DESIGN-SYSTEM §6.2).
 */
export function SelectField({
  id,
  name,
  label,
  value,
  onChange,
  options,
  error,
  hint,
  optional = false,
  placeholder = 'Select\u2026',
}: SelectFieldProps) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <select
        id={id}
        className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''}`}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-error ${id}-hint`}
        required={!optional}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
