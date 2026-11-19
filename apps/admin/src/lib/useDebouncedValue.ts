import { useEffect, useRef, useState } from 'react';

/**
 * Debounced live search value.
 *
 * The raw keystrokes return immediately for a responsive input; the debounced
 * value - the one that belongs in a queryKey - follows ~300ms after the user
 * stops typing. Stale requests are a non-issue by construction: React Query
 * keys each fetch by the debounced value, so only the latest term's response
 * can land in the active query state. Superseded results are isolated; already-
 * started network requests are not guaranteed to be cancelled. Unmount clears
 * the pending debounce timer.
 *
 * `onSettled` runs inside the timeout (never synchronously in an effect), so
 * callers can safely reset pagination or mirror the term into an applied
 * filter there.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300, onSettled?: (value: T) => void): T {
  const [debounced, setDebounced] = useState(value);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
      settledRef.current?.(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
