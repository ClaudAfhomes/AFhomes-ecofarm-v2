import { useId } from 'react';
import { Icon, type IconName } from '@afhomes/ui';
import v4 from './CustomerApplicationV4.module.css';
import styles from './ApplicationChoiceCards.module.css';

export function ApplicationChoiceCards({
  label,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  compact = false,
  segmented = false,
  appearance = 'tiles',
  twoColumn = false,
  threeColumn = false,
  legend,
}: {
  label: string;
  value: string;
  options: readonly {
    value: string;
    label: string;
    ariaLabel?: string;
    description?: string;
    icon?: IconName;
    glyph?: string;
  }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Dense, full-width, label-only tiles (one per row) instead of the
   * roomier icon+description card grid - for a closed set of short choices
   * (e.g. ID Type) where the spacious card style would be mostly empty
   * space. */
  compact?: boolean;
  segmented?: boolean;
  appearance?: 'tiles' | 'inline' | 'civil';
  /** Fixed two-column grid (the reference's payment-scheme tiles), instead
   * of the default responsive auto-fit. */
  twoColumn?: boolean;
  threeColumn?: boolean;
  legend?: string;
}) {
  const name = useId();
  return (
    <fieldset
      className={`${styles.group} ${v4.choiceGroup} ${appearance === 'civil' ? v4.fullWidth : ''}`}
      disabled={disabled}
      aria-label={label}
    >
      <legend className={`${styles.legend} ${segmented ? v4.sr : v4.secTitle}`}>{legend ?? label}</legend>
      <div
        className={`${styles.options} ${segmented ? v4.tiers : appearance === 'civil' ? v4.civilChoices : appearance === 'inline' ? v4.radioRow : `${v4.tiles} ${threeColumn ? v4.three : ''}`}`}
        data-compact={compact || undefined}
        data-segmented={segmented || undefined}
        data-two-column={twoColumn || undefined}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={`${styles.option} ${segmented ? v4.tier : appearance !== 'tiles' ? v4.seg : v4.tile} ${value === option.value ? v4.sel : ''}`}
            data-selected={value === option.value}
          >
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              required={required}
              aria-label={option.ariaLabel ?? option.label}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.content}>
              {option.glyph || option.icon ? (
                <span className={v4.tileicon}>
                  {option.glyph ?? (option.icon ? <Icon name={option.icon} size={16} /> : null)}
                </span>
              ) : null}
              <span className={styles.copy}>
                <strong className={styles.title}>{option.label}</strong>
                {option.description ? (
                  <small className={styles.description}>{option.description}</small>
                ) : null}
              </span>
            </span>
            {value === option.value ? (
              <span className={v4.check}>
                <Icon name="check" size={14} />
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
