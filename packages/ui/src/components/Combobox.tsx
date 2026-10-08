/**
 * Accessible searchable combobox (ARIA 1.2 list-autocomplete pattern).
 *
 * The input carries `role="combobox"` and owns the listbox through
 * `aria-controls` + `aria-activedescendant`, so a screen reader announces the
 * result count, the active option and the selection without the listbox ever
 * stealing focus.
 *
 * ONE RULE SHAPES THE WHOLE COMPONENT: a typed string is never a value. The
 * input text is a draft used for searching. Only `onSelect(option)` - fired by a
 * click, Enter, or the clear button - changes the committed value, and a draft
 * that matches nothing is thrown away on blur. A component that committed what
 * the user typed would let any invented string pass as a verified geographic
 * code, which is exactly the failure the server then has to catch.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { rankOptions, type Rankable } from '../combobox-rank.js';
import { Icon } from './Icon.js';
import { IconButton } from './IconButton.js';
import { Spinner } from './Spinner.js';
import styles from './Combobox.module.css';

export interface ComboboxOption extends Rankable {
  /** Free discriminator, e.g. `city` | `municipality`. Never used for matching. */
  type?: string;
}

export interface ComboboxProps {
  id: string;
  label: string;
  /** The committed selection, or null. Drives the displayed value. */
  value: ComboboxOption | null;
  options: readonly ComboboxOption[];
  /** Receives the chosen option, or null when cleared. Never a free-text string. */
  onSelect: (option: ComboboxOption | null) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
  /** Explains WHY the control is disabled ("Select a province first"). */
  disabledHint?: string;
  /**
   * Fired when the list opens. The hook seam for loading options lazily: a long
   * form should not fetch a reference list for a field nobody touched.
   */
  onOpen?: () => void;
  placeholder?: string;
  /** Extra wording so three levels do not all read "Loading…". */
  loadingLabel?: string;
  required?: boolean;
  emptyMessage?: string;
  renderOption?: (option: ComboboxOption) => ReactNode;
}

export function Combobox({
  id,
  label,
  value,
  options,
  onSelect,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  disabledHint,
  onOpen,
  placeholder,
  loadingLabel = 'Loading',
  required = false,
  emptyMessage,
  renderOption,
}: ComboboxProps) {
  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const uid = useId();

  const [open, setOpen] = useState(false);
  /** The displayed answer. Never a filter. */
  const [draft, setDraft] = useState(value?.name ?? '');
  /**
   * What the user is currently searching for, which is EMPTY while merely
   * browsing. Kept apart from `draft` on purpose: if opening a filled control
   * filtered by its own text, the user could only re-pick what they already had,
   * and a stored value the list does not recognise would hide every option with
   * no way back out.
   */
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef = useRef<HTMLDivElement>(null);
  /** Set when a selection commits, so the next blur does not "revert" it. */
  const committedRef = useRef(false);

  // Follow the committed value from outside (a reset, or a loaded record).
  // Keyed on the CODE, not the object, so a re-fetch returning a new object with
  // the same code does not yank a user-typed draft out from under them.
  const valueCode = value?.code ?? '';
  useEffect(() => {
    setDraft(value?.name ?? '');
    setFilter('');
    if (committedRef.current) committedRef.current = false;
  }, [valueCode, value?.name]);

  const matches = useMemo(() => rankOptions(options, filter), [options, filter]);
  const optionId = (index: number) => `${id}-option-${uid}-${index}`;

  const showList = open && !disabled && !error;
  /**
   * A status message describes the LIST, so it is only meaningful while the user
   * is looking at the list or a request is actually in flight. Otherwise a
   * lazily-loaded, not-yet-touched combbox would announce "Loading provinces…"
   * forever - `isPending` is true for a DISABLED query in TanStack Query v5 - or
   * claim an unfetched list is empty, which is a different and wrong statement.
   */
  const showStatus = showList || loading;
  const statusText = loading
    ? `${loadingLabel}…`
    : !loading && matches.length === 0 && filter.trim().length > 0
      ? `No match for “${filter.trim()}”`
      : !loading && options.length === 0 && !disabled
        ? (emptyMessage ?? `No ${label.toLowerCase()} to show yet`)
        : null;

  /** Open for browsing: full list, no filter applied. */
  const openToBrowse = () => {
    if (disabled || error) return;
    onOpen?.();
    setFilter('');
    setActiveIndex(-1);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  const commit = (option: ComboboxOption | null) => {
    committedRef.current = true;
    setDraft(option?.name ?? '');
    setFilter('');
    close();
    onSelect(option);
  };

  /** Discard an uncommitted draft: the input always ends up on a real value. */
  const revert = () => {
    setDraft(value?.name ?? '');
    setFilter('');
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        revert();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, value?.name]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return openToBrowse();
      if (matches.length === 0) return;
      setActiveIndex((current) => {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        return (current + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && matches[activeIndex]) {
        event.preventDefault();
        commit(matches[activeIndex]);
      }
      // Enter with nothing active must NOT submit a draft: no value, no commit.
      return;
    }
    if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      revert();
      close();
    }
  };

  const activeId = activeIndex >= 0 && matches[activeIndex] ? optionId(activeIndex) : undefined;

  return (
    <div className={styles.wrap} ref={wrapRef} data-testid={`${id}-combobox`}>
      <span className={styles.label} id={labelId}>
        {label}
        {required ? ' *' : null}
      </span>

      <div className={styles.control} data-disabled={disabled ? 'true' : 'false'}>
        <input
          id={id}
          className={styles.input}
          role="combobox"
          type="text"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          disabled={disabled}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setFilter(e.target.value);
            setActiveIndex(-1);
            if (!open) setOpen(true);
          }}
          onFocus={openToBrowse}
          onBlur={() => {
            // A draft that was never selected is discarded, so the input can
            // never hold an invented name.
            if (!committedRef.current) revert();
            close();
          }}
          onKeyDown={onKeyDown}
        />

        {/* Decorative: the visible "Loading provinces…" status below is what a
            screen reader needs, and announcing it twice would be noise. */}
        {loading ? <Spinner size="sm" /> : null}

        {value ? (
          <IconButton icon="close" label={`Clear ${label.toLowerCase()}`} onClick={() => commit(null)} disabled={disabled} />
        ) : null}

        <Icon name="chevron-down" size={16} aria-hidden="true" />
      </div>

      {error ? (
        <div className={`${styles.status} ${styles.error}`} role="alert" id={errorId}>
          <span>{error}</span>
          {onRetry ? (
            <button type="button" className={styles.retry} onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {!error && showStatus && statusText ? (
        <div className={styles.status} role="status">
          {statusText}
        </div>
      ) : null}

      <span className={styles.hint} id={hintId}>
        {disabled && disabledHint ? disabledHint : ''}
      </span>

      {showList && matches.length > 0 ? (
        <ul className={styles.listbox} id={listboxId} role="listbox" aria-label={label}>
          {matches.map((option, index) => (
            <li
              key={option.code}
              id={optionId(index)}
              className={styles.option}
              role="option"
              // Deliberate, not incidental: without this the name is whatever the
              // descendant text happens to concatenate to. The type is part of the
              // answer for a locality (city vs municipality), so it is announced.
              aria-label={option.type ? `${option.name} (${option.type})` : option.name}
              aria-selected={option.code === valueCode}
              data-active={index === activeIndex ? 'true' : 'false'}
              // `pointerdown` + preventDefault so the click lands before blur
              // reverts the draft; a plain `onClick` would race it.
              onPointerDown={(e) => {
                e.preventDefault();
                commit(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {renderOption ? renderOption(option) : option.name}
              {/* A custom row owns its whole presentation, badge included. */}
              {!renderOption && option.type ? (
                <span className={styles.kind}>{option.type}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}