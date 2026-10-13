import { useRef } from 'react';
import {
  useMutation,
  type MutateOptions,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

/**
 * `useMutation` with double-submit protection.
 *
 * A second submit of the SAME payload while one is in flight joins the
 * in-flight request instead of firing a second one, so a double click before
 * React has painted the disabled state cannot record two payments, sales, or
 * qualifications. Submissions with DIFFERENT payloads still run concurrently
 * (toggling two plans quickly must not swallow either toggle).
 *
 * The flight check runs synchronously at submit time, so even two submits in
 * the same tick coalesce. Everything else keeps exact TanStack semantics:
 * `onMutate`/`onSuccess`/`onError` fire per execution, and `isPending`,
 * `data`, `error`, and `reset` behave as callers expect. A coalesced submit
 * skips its own `onMutate` (the in-flight execution already ran it with the
 * same payload); every `onMutate` in this app only sets local busy flags, so
 * nothing is lost. Prefer this over a hand-rolled `useSingleFlight` wrapper
 * at each call site.
 */
export function useBusinessMutation<TData, TError = Error, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const mutation = useMutation(options);
  const inFlight = useRef(new Map<string, Promise<TData>>());
  const runFlighted = (
    variables: TVariables,
    mutateOptions?: MutateOptions<TData, TError, TVariables, TContext>,
  ): Promise<TData> => {
    const flightKey = stableKey(variables);
    const existing = inFlight.current.get(flightKey);
    if (existing) return existing;
    const pending = mutation.mutateAsync(variables, mutateOptions);
    inFlight.current.set(flightKey, pending);
    const clear = () => {
      if (inFlight.current.get(flightKey) === pending) inFlight.current.delete(flightKey);
    };
    pending.then(clear, clear);
    return pending;
  };
  const mutate: UseMutateFunction<TData, TError, TVariables, TContext> = (...args) => {
    const [variables, mutateOptions] = args as [
      TVariables,
      MutateOptions<TData, TError, TVariables, TContext>?,
    ];
    // Failures surface through `onError`, mirroring `mutate`.
    void runFlighted(variables, mutateOptions).catch(() => undefined);
  };
  const mutateAsync: UseMutateAsyncFunction<TData, TError, TVariables, TContext> = (...args) => {
    const [variables, mutateOptions] = args as [
      TVariables,
      MutateOptions<TData, TError, TVariables, TContext>?,
    ];
    return runFlighted(variables, mutateOptions);
  };
  return {
    ...mutation,
    mutate,
    mutateAsync,
  };
}

/** Stable serialization for payload comparison: sorted keys, like `useMutationRequest`. */
function stableKey(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}
