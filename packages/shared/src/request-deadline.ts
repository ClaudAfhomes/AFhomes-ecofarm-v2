/** Bound session lookup, fetch and body consumption with one deadline. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) cancel();
  controller.signal.throwIfAborted();
  callerSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('API request deadline exceeded', 'TimeoutError')),
    60_000,
  );
  let rejectAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    // Auth SDK calls are not abortable; the race still releases the waiting UI.
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
