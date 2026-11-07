import { useId } from 'react';
import { Icon, type IconName } from '@afhomes/ui';
import styles from './ApplicationChoiceCards.module.css';

export function ApplicationChoiceCards({
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; description?: string; icon?: IconName }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.options}>
        {options.map((option) => (
          <label
            key={option.value}
            className={styles.option}
            data-selected={value === option.value}
          >
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              required={required}
              aria-label={option.label}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.content}>
              {option.icon ? <Icon name={option.icon} size={20} /> : null}
              <span className={styles.copy}>
                <span className={styles.title}>{option.label}</span>
                {option.description ? (
                  <span className={styles.description}>{option.description}</span>
                ) : null}
              </span>
            </span>
            {value === option.value ? <Icon name="check" size={16} /> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
