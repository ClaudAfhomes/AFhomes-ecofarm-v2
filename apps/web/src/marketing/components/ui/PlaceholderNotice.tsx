import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Clearly-marked placeholder used for content that hasn't been supplied yet.
 * Never presents itself as official AFhomes documentation.
 */
export function PlaceholderNotice({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-dashed border-navy-300/60 bg-cream-50 p-8",
        className,
      )}
    >
      <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-ink-400 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
        Placeholder · {title}
      </p>
      <div className="mt-4 leading-relaxed text-ink-600">{children}</div>
    </div>
  );
}