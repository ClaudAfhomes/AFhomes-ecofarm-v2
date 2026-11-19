import { useCallback, useEffect, useState } from "react";

interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Runs an async factory, tracking loading / error / data with built-in
 * cancellation when deps change.
 */
export function useAsync<T>(
  factory: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Reset to loading synchronously when the inputs change so stale data
    // never renders (source behavior, Phase 3 port).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    factory()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, retry };
}