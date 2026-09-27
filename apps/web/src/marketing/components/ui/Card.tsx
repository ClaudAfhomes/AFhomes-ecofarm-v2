import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "../../lib/cn";

interface CardProps extends ComponentPropsWithoutRef<"div"> {
  /** Semantic element for the card root. */
  as?: ElementType;
  /** Add internal padding. */
  padded?: boolean;
  /** Restrained elevation (default cards sit flat — luxury prefers typography over shadows). */
  elevated?: boolean;
  /** Hover lift for interactive cards. */
  interactive?: boolean;
}

/**
 * Editorial card foundation. Imagery and typography carry the card —
 * elevation is opt-in and restrained.
 */
export function Card({
  as: Tag = "div",
  padded = true,
  elevated = false,
  interactive = false,
  className,
  ...props
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border border-line bg-surface text-ink-800",
        padded && "p-6 sm:p-8",
        elevated && "shadow-soft",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-300 motion-safe:hover:-translate-y-1 hover:shadow-lift hover:border-line-dark/40",
        className,
      )}
      {...props}
    />
  );
}