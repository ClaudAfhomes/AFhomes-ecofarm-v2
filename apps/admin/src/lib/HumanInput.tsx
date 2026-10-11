import { useContext, useEffect, useId, useState, type ComponentProps } from 'react';
import { HumanInputValidity } from './human-input-validity';
import { NormalizedInput } from '@afhomes/ui';
import {
  personNameSchema,
  phoneSchema,
  emailSchema,
  exactDecimalStringSchema,
  optionalLandlineSchema,
} from '@afhomes/contracts';

/** Shared contract validation for interacted-with human fields. Server validation remains mandatory. */
export function HumanInput({
  onChange,
  onBlur,
  landline = false,
  ...props
}: ComponentProps<typeof NormalizedInput> & { landline?: boolean }) {
  const id = useId();
  const [dirty, setDirty] = useState(false);
  const [blockedPhone, setBlockedPhone] = useState(false);
  const phone = props.type === 'tel' || props.inputMode === 'tel';
  const schema = props.suggestName
    ? personNameSchema
    : landline
      ? optionalLandlineSchema
      : phone
        ? phoneSchema
        : props.type === 'email'
          ? emailSchema
          : props.inputMode === 'decimal'
            ? exactDecimalStringSchema
            : null;
  const value = String(props.value ?? '');
  const invalid =
    blockedPhone ||
    (dirty && schema && (props.required || value !== '') && !schema.safeParse(value).success);
  // Name errors carry no text: the field itself turns red (see the global
  // `aria-invalid` rule) and stays reported through HumanInputValidity, so
  // blocking and guidance keep working without the paragraph.
  const message = phone
    ? 'Enter a valid contact number. Letters are not accepted.'
    : props.type === 'email'
      ? 'Please enter a valid email address.'
      : props.inputMode === 'decimal'
        ? 'Enter a valid amount without letters or scientific notation.'
        : null;
  const errorId = `${id}-error`;
  const report = useContext(HumanInputValidity);
  useEffect(() => {
    report?.(id, Boolean(invalid));
    return () => report?.(id, false);
  }, [id, invalid, report]);
  return (
    <>
      <NormalizedInput
        {...props}
        aria-invalid={invalid ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], invalid && message ? errorId : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onBlur={(event) => {
          setDirty(true);
          onBlur?.(event);
        }}
        onChange={(event) => {
          setDirty(true);
          if (phone && !landline && /\p{L}/u.test(event.target.value)) {
            setBlockedPhone(true);
            return;
          }
          // Appending digits after rejected letters must not silently turn an
          // invalid typed number into a valid one. Clear on a deliberate
          // replacement, deletion or reset, then validate the corrected value.
          if (
            event.target.value === '' ||
            !event.target.value.startsWith(value) ||
            event.target.value.length !== value.length + 1
          )
            setBlockedPhone(false);
          onChange?.(event);
        }}
      />
      {invalid && message ? (
        <small id={errorId} role="alert">
          {message}
        </small>
      ) : null}
    </>
  );
}
