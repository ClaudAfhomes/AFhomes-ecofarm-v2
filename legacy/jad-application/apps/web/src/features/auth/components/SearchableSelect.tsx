import { useDeferredValue, useEffect, useId, useRef, useState } from 'react';

import { FormField } from './FormField';
import { fieldStyles } from './fieldStyles';
import styles from './SearchableSelect.module.css';

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  id: string;
  name: string;
  label: string;
  /** Selected option value ('' when nothing is selected). */
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * Searchable single-select for long reference lists (provinces, cities,
 * barangays). Typing filters the list; committing a value is only possible
 * through a listed option - free text that matches nothing reverts on blur
 * and is never submitted, so arbitrary input cannot bypass the controlled
 * options. Filter input is deferred to keep typing responsive on 40k+ rows.
 */
export function SearchableSelect({
  id,
  name,
  label,
  value,
  options,
  onChange,
  error,
  hint,
  optional = false,
  placeholder = 'Type to search…',
  disabled = false,
  loading = false,
}: SearchableSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  // Keep the visible text in sync with external resets (parent change clears
  // the selection) and late-loading options: when closed and the selection
  // moved on, adopt its label. Adjusted during render (never in an effect)
  // so in-progress typing while open is never clobbered.
  const selectedLabel = selected?.label ?? '';
  const [synced, setSynced] = useState<{ value: string; label: string } | null>(null);
  if (
    !open &&
    (synced === null || synced.value !== value || synced.label !== selectedLabel)
  ) {
    setSynced({ value, label: selectedLabel });
    setQuery(selectedLabel);
  }

  const normalized = deferredQuery.trim().toLowerCase();
  const matches =
    normalized === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(normalized));
  // Clamp the highlight to the current match window instead of resetting it
  // in an effect - the list shrinks as the user types.
  const safeHighlight = Math.min(highlight, Math.max(matches.length - 1, 0));

  const commit = (option: SearchableOption | null) => {
    onChange(option?.value ?? '');
    setQuery(option?.label ?? '');
    setOpen(false);
  };

  const revert = () => {
    // Exact label match (case-insensitive) commits; anything else reverts to
    // the current selection so free text can never leak into the value.
    const exact = options.find(
      (option) => option.label.toLowerCase() === query.trim().toLowerCase(),
    );
    if (exact && exact.value !== value) commit(exact);
    else {
      setQuery(selected?.label ?? '');
      setOpen(false);
    }
  };

  // Close on outside pointer-down (before blur reverts the text).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open ]);

  const describedBy =
    [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <FormField id={id} label={label} hint={hint} error={error} optional={optional}>
      <div className={styles.wrap} ref={wrapRef}>
        <input
          id={id}
          name={name}
          className={`${fieldStyles.input} ${error ? fieldStyles.inputError : ''}`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && matches[safeHighlight] ? `${listId}-${safeHighlight}` : undefined
          }
          aria-autocomplete="list"
          value={query}
          placeholder={selected ? selected.label : placeholder}
          disabled={disabled || loading}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={!optional}
          onFocus={() => {
            if (disabled || loading) return;
            // Reopening a filled field clears to the full list for browsing;
            // leaving without choosing reverts to the selection on blur.
            if (selected && query === selected.label) setQuery('');
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onBlur={revert}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setHighlight((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && open && matches[safeHighlight]) {
              event.preventDefault();
              commit(matches[safeHighlight]!);
            }
          }}
        />
        {open && !disabled && !loading ? (
          <ul id={listId} role="listbox" aria-label={label} className={styles.list}>
            {matches.length === 0 ? (
              <li className={styles.empty} aria-disabled="true">
                No matches - refine your search.
              </li>
            ) : (
              matches.slice(0, 100).map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`${styles.option} ${index === safeHighlight ? styles.highlighted : ''} ${
                    option.value === value ? styles.selected : ''
                  }`}
                  onMouseDown={(event) => {
                    // Select on pointer-down so blur does not revert first.
                    event.preventDefault();
                    commit(option);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </FormField>
  );
}
