import { useId } from 'react';

import styles from './CmsFields.module.css';

function countTone(valueLength: number, maxLength: number): string {
  const ratio = valueLength / maxLength;
  if (ratio >= 0.95) return 'countDanger';
  if (ratio >= 0.8) return 'countWarn';
  return 'count';
}

export function CmsTextField({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const baseId = useId();
  const fieldId = `${baseId}-field`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const countId = typeof maxLength === 'number' ? `${baseId}-count` : undefined;
  const describedBy = [hintId, errorId, countId].filter(Boolean).join(' ') || undefined;
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <input
        id={fieldId}
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      <span className={styles.metaRow}>
        {error ? (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        ) : (
          <span />
        )}
        {typeof maxLength === 'number' ? (
          <span
            id={countId}
            className={(styles as Record<string, string>)[countTone(value.length, maxLength)]}
            aria-live="polite"
            aria-atomic="true"
          >
            {value.length}/{maxLength}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function CmsSelectField({
  label,
  hint,
  error,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const baseId = useId();
  const fieldId = `${baseId}-field`;
  const labelId = `${baseId}-label`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <label className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <select
        id={fieldId}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-labelledby={labelId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function CmsToggleField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const baseId = useId();
  const fieldId = `${baseId}-field`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const describedBy = hintId;
  return (
    <label
      className={styles.field}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
      }}
    >
      <input
        id={fieldId}
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2 }}
        aria-describedby={describedBy}
      />
      <span className={styles.label} style={{ flex: '1 1 0', minWidth: 0, overflowWrap: 'anywhere' }}>
        {label}
      </span>
      {hint ? (
        <span
          id={hintId}
          className={styles.hint}
          style={{ flexBasis: '100%', overflowWrap: 'anywhere' }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function CmsTextareaField({
  label,
  hint,
  error,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  const baseId = useId();
  const fieldId = `${baseId}-field`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const countId = typeof maxLength === 'number' ? `${baseId}-count` : undefined;
  const describedBy = [hintId, errorId, countId].filter(Boolean).join(' ') || undefined;
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {hint ? (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      ) : null}
      <textarea
        id={fieldId}
        className={styles.textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
      />
      <span className={styles.metaRow}>
        {error ? (
          <span id={errorId} className={styles.error} role="alert">
            {error}
          </span>
        ) : (
          <span />
        )}
        {typeof maxLength === 'number' ? (
          <span
            id={countId}
            className={(styles as Record<string, string>)[countTone(value.length, maxLength)]}
            aria-live="polite"
            aria-atomic="true"
          >
            {value.length}/{maxLength}
          </span>
        ) : null}
      </span>
    </label>
  );
}
