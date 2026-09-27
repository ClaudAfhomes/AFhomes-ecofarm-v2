const endpoint = import.meta.env.VITE_ERROR_REPORTING_ENDPOINT?.trim();

export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (!endpoint) return;
  const value = error instanceof Error ? error : new Error(String(error));
  const payload = JSON.stringify({
    message: value.message,
    stack: value.stack,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    context,
    occurredAt: new Date().toISOString(),
  });
  if (!navigator.sendBeacon?.(endpoint, new Blob([payload], { type: "application/json" }))) {
    void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (event) => reportError(event.error ?? event.message, { source: "window.error" }));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, { source: "unhandledrejection" }));
}
