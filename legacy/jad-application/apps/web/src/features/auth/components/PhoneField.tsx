import { FieldError } from './FormField';
import { fieldStyles } from './fieldStyles';
import styles from './RegistrationForm.module.css';
import {
  buildPhoneRuleForDial,
  dialCodeOptions,
  maxNationalLength,
  sanitizeNationalInput,
  type CountryPhoneMeta,
} from '../registrationValidation';

export interface PhoneFieldProps {
  /** Dial digits without '+', e.g. '63'. */
  dial: string;
  /** National significant number digits (controlled by the caller). */
  national: string;
  countries: CountryPhoneMeta[] | undefined;
  error?: string;
  onDialChange: (dial: string) => void;
  /** Receives digits-only input already capped at the dial's limit. */
  onNationalChange: (value: string) => void;
}

/**
 * Phone number input for registration: a country-code dropdown plus the
 * national-number field. The allowed digit count comes from the selected
 * dial's curated rule (`GET /config/public` metadata via `toPhoneRule`,
 * generic E.164 fallback) - input is sanitized to digits and truncated at
 * that limit on every change, so typing and pasting can never exceed it.
 * Length/format enforcement itself stays in `validatePhoneNumber`; the full
 * E.164 value is composed at submit (`composeE164Phone`).
 */
export function PhoneField({
  dial,
  national,
  countries,
  error,
  onDialChange,
  onNationalChange,
}: PhoneFieldProps) {
  const options = dialCodeOptions(countries);
  const rule = buildPhoneRuleForDial(countries, dial);
  const maxLen = maxNationalLength(rule);
  const lengths = [...rule.nationalLengths].sort((a, b) => a - b);
  const hint = dial
    ? `+${dial} - ${lengths.length > 1 ? `${lengths[0]}-${lengths[lengths.length - 1]} digits` : `${maxLen} digits`}.`
    : undefined;
  const describedBy =
    [error ? 'reg-phone-error' : null, hint && !error ? 'reg-phone-hint' : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div>
      <div className={styles.phoneRow}>
        <div className={styles.phoneDial}>
          <label className={fieldStyles.label} htmlFor="reg-phoneDial">
            Country code
          </label>
          <select
            id="reg-phoneDial"
            className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''}`}
            name="phoneDial"
            value={options.some((option) => option.dial === dial) ? dial : ''}
            onChange={(event) => onDialChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            required
          >
            <option value="">Select…</option>
            {options.map((option) => (
              <option key={option.dial} value={option.dial}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.phoneNational}>
          <label className={fieldStyles.label} htmlFor="reg-phone">
            Phone number
          </label>
          <input
            id="reg-phone"
            className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''}`}
            type="tel"
            name="phone"
            value={national}
            onChange={(event) =>
              onNationalChange(sanitizeNationalInput(event.target.value, dial, maxLen))
            }
            autoComplete="tel"
            inputMode="numeric"
            maxLength={maxLen}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            required
          />
        </div>
      </div>
      {error ? (
        <FieldError id="reg-phone-error">{error}</FieldError>
      ) : hint ? (
        <p id="reg-phone-hint" className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
