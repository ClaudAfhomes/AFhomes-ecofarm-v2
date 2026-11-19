import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn";
import { SmartImage } from "../../components/ui/SmartImage";
import type { ImageSpec } from "../../lib/images";
import { EASE } from "../../lib/motion";

interface ImageRevealProps {
  spec: ImageSpec;
  className?: string;
  ratio?: string;
  duration?: number;
}

/**
 * Cinematic image reveal — the image settles from an enlarged scale while a
 * cover panel slides away. Skipped entirely when the user prefers reduced
 * motion so content is never hidden behind the cover.
 */
export function ImageReveal({
  spec,
  className,
  ratio = "aspect-[4/3]",
  duration = 0.9,
}: ImageRevealProps) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div className={cn("relative overflow-hidden", ratio, className)}>
        <SmartImage spec={spec} priority />
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", ratio, className)}>
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.08 }}
        whileInView={{ scale: 1.02 }}
        viewport={{ once: true, margin: "-10% 0px" }}
        transition={{ duration: duration + 0.4, ease: EASE }}
      >
        <SmartImage spec={spec} priority />
      </motion.div>
      {/* Cover panel — initially covers the image, then lifts away to reveal
          it. The default clip-path keeps the panel hidden (image visible) so
          content never stays covered if the animation is skipped or fails. */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-cream-200 [clip-path:inset(0_0_100%_0)]"
        aria-hidden="true"
        initial={{ clipPath: "inset(0 0 0% 0)" }}
        whileInView={{ clipPath: "inset(0 0 100% 0)" }}
        viewport={{ once: true, margin: "-10% 0px" }}
        transition={{ duration, ease: EASE }}
      />
    </div>
  );
}