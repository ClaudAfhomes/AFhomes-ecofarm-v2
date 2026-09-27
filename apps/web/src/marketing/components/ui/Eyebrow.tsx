import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface EyebrowProps {
  children: ReactNode;
  tone?: "light" | "dark";
  className?: string;
}

/** Small uppercase label with a trailing accent rule. */
export function Eyebrow({ children, tone = "light", className }: EyebrowProps) {
  return (
    <p
      className={cn(
        "label-caps flex items-center gap-3",
        tone === "dark" ? "text-cream-300" : "text-ink-500",
        className,
      )}
    >
      <span
        className={cn("h-px w-8", tone === "dark" ? "bg-gold-400" : "bg-leaf-600")}
        aria-hidden="true"
      />
      <span>{children}</span>
    </p>
  );
}