import { CmsTextField } from './CmsFields';
import styles from './CmsCtaFields.module.css';
import type { CmsCtaLink } from '@jad/contracts';

export function CmsCtaFields({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: CmsCtaLink;
  onChange: (next: CmsCtaLink) => void;
  error?: string;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.stack}>
        <CmsTextField
          label="Label"
          value={value.label}
          onChange={(label) => onChange({ ...value, label })}
          maxLength={40}
          placeholder="e.g. Explore Properties"
        />
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </fieldset>
  );
}
