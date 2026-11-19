import { useRef } from 'react';
/** Coalesce clicks before React has painted the mutation's disabled state. */
export function useSingleFlight<T>() {
  const active = useRef<Promise<T> | null>(null);
  return (operation: () => Promise<T>): Promise<T> => {
    if (active.current) return active.current;
    const pending = Promise.resolve().then(operation);
    active.current = pending;
    const clear = () => {
      if (active.current === pending) active.current = null;
    };
    void pending.then(clear, clear);
    return pending;
  };
}
