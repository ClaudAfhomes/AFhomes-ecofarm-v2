import { useRef } from 'react';

/** Stable within one logical form action, including a timeout-after-commit retry. */
export function useMutationRequest() {
  const current = useRef<{ payload: string; id: string } | null>(null);
  return {
    forPayload: (payload: unknown): string => {
      const normalized = JSON.stringify(payload, (_key, value: unknown) => {
        if (value && typeof value === 'object' && !Array.isArray(value))
          return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
        return value;
      });
      if (!current.current || current.current.payload !== normalized)
        current.current = { payload: normalized, id: crypto.randomUUID() };
      return current.current.id;
    },
    complete: () => {
      current.current = null;
    },
  };
}
