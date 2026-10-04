import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

type Props = ComponentProps<'input'> & {
  normalize?: (value: string) => string;
  suggestName?: boolean;
};

/** Controlled normalization with selection mapping and an unmodified IME draft. */
export function NormalizedInput({
  normalize,
  suggestName = false,
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onBlur,
  ...props
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const composing = useRef(false);
  const nameSuggested = useRef(false);
  const pending = useRef<{
    input: HTMLInputElement;
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
  } | null>(null);

  useLayoutEffect(() => {
    const selection = pending.current;
    pending.current = null;
    if (selection && document.activeElement === selection.input) {
      selection.input.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  }, [value, revision]);

  return (
    <input
      {...props}
      value={draft ?? value}
      onBlur={(event) => {
        const input = event.currentTarget;
        // Suggest once; deliberately corrected capitalization is never overwritten.
        if (suggestName && !nameSuggested.current && input.value.trim()) {
          nameSuggested.current = true;
          if (!/\p{Lu}/u.test(input.value)) {
            input.value = input.value.replace(
              /(^|[\s'’\-])(\p{L})/gu,
              (_, boundary: string, letter: string) => boundary + letter.toLocaleUpperCase(),
            );
            onChange?.({ ...event, target: input, currentTarget: input, type: 'change' });
          }
        }
        onBlur?.(event);
      }}
      onCompositionStart={(event) => {
        composing.current = true;
        setDraft(event.currentTarget.value);
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        setDraft(null);
        // Commit only the completed composition.
        const input = event.currentTarget;
        const raw = input.value;
        if (normalize) {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          if (start !== null && end !== null)
            pending.current = {
              input,
              start: normalize(raw.slice(0, start)).length,
              end: normalize(raw.slice(0, end)).length,
              direction: input.selectionDirection ?? 'none',
            };
        }
        if (normalize) input.value = normalize(raw);
        onCompositionEnd?.(event);
        // Composition events have the same input target needed by controlled change handlers.
        onChange?.({ ...event, target: input, currentTarget: input, type: 'change' });
        setRevision((n) => n + 1);
      }}
      onChange={(event) => {
        if (composing.current) {
          setDraft(event.currentTarget.value);
          return;
        }
        const input = event.currentTarget;
        const raw = input.value;
        if (normalize && input.selectionStart !== null && input.selectionEnd !== null) {
          pending.current = {
            input,
            start: normalize(raw.slice(0, input.selectionStart)).length,
            end: normalize(raw.slice(0, input.selectionEnd)).length,
            direction: input.selectionDirection ?? 'none',
          };
        }
        if (normalize) input.value = normalize(raw);
        onChange?.(event);
        setRevision((n) => n + 1);
      }}
    />
  );
}
