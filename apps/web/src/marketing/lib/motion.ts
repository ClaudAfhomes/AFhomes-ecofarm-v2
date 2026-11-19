/**
 * AFhomes motion design system — Phase 6.
 *
 * A single, calm motion vocabulary for the whole site. All durations and
 * easings live here so the site moves as one voice. Only transform, opacity
 * and clip-path are ever animated — never layout properties or heavy filters.
 */
import type { Variants } from "motion/react";

/** Signature easing — soft deceleration, luxury restraint. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Duration tokens (seconds). */
export const DURATION = {
  /** Button press, icon nudge, dot pulse. */
  micro: 0.18,
  /** Menus, small panels, hover states. */
  fast: 0.3,
  /** Accordion, mobile menu, header transitions. */
  ui: 0.4,
  /** In-view content reveals. */
  reveal: 0.8,
  /** Cinematic image reveals. */
  image: 1.1,
} as const;

/** Shared viewport config — reveals trigger once, just inside the frame. */
export const VIEWPORT = { once: true, margin: "-12% 0px -12% 0px" } as const;

/** Fade + rise — the signature content reveal. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.reveal, ease: EASE },
  },
};

/** Pure fade — for delicate or dense elements. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.fast, ease: EASE },
  },
};

/** Fade + gentle scale — cards, panels, imagery. */
export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.985 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: DURATION.reveal, ease: EASE },
  },
};

/** Parent for sequential group reveals (used by Stagger / StaggerItem). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

/** Child of a stagger container. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.fast, ease: EASE },
  },
};
