import { useState } from "react";
import { cn } from "../../lib/cn";
import type { ImageSpec } from "../../lib/images";

interface SmartImageProps {
  spec: ImageSpec;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  sizes?: string;
  /** Tailwind object-position utility (e.g. "object-center", "object-top"). */
  objectPosition?: string;
}

/**
 * Responsive image with lazy loading and an elegant editorial fallback if a
 * placeholder fails to load. Spec keeps layout code stable when official
 * AFhomes photography is swapped in.
 */
export function SmartImage({
  spec,
  className,
  imgClassName,
  priority = false,
  sizes = "(max-width: 768px) 100vw, 60vw",
  objectPosition = "object-center",
}: SmartImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !spec.src) {
    return (
      <div
        role="img"
        aria-label={spec.alt}
        className={cn(
          "flex h-full w-full items-center justify-center bg-gradient-to-br from-pine-900 via-sage-600 to-sage-300",
          className,
          imgClassName,
        )}
      >
        <span className="px-6 text-center font-display text-lg text-cream-100/90 italic">
          {spec.alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={spec.src}
      alt={spec.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      sizes={sizes}
      onError={() => setFailed(true)}
      className={cn(
        "h-full w-full object-cover",
        objectPosition,
        imgClassName,
        className,
      )}
    />
  );
}