import { cn } from "../../lib/cn";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center" role="status" aria-live="polite">
      <span className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-2.5 w-2.5 animate-dot-breathe rounded-full bg-coral-500"
            style={{ animationDelay: `${index * 0.2}s` }}
          />
        ))}
      </span>
      <span className="label-caps text-ink-600">{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this content. Please try again.",
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-20 text-center", className)} role="alert">
      <p className="font-display text-2xl font-medium text-navy-900">{title}</p>
      <p className="max-w-md text-ink-500">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full border border-navy-300 px-6 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:border-navy-800 hover:bg-navy-800 hover:text-cream-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  message = "New content will appear here soon.",
  className,
}: {
  title?: string;
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-20 text-center", className)}>
      <p className="font-display text-2xl font-medium text-navy-900">{title}</p>
      <p className="max-w-md text-ink-500">{message}</p>
    </div>
  );
}
