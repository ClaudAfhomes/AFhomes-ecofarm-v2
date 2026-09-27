import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { EASE, VIEWPORT } from "../../lib/motion";

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Extra delay before the first child begins (seconds). */
  delay?: number;
  /** Seconds between children. */
  gap?: number;
}

/**
 * Reveals its StaggerItem children one after another when scrolled into
 * view — the calm, sequential rhythm for lists of cards and milestones.
 */
export function Stagger({ children, className, delay = 0.05, gap = 0.07 }: StaggerProps) {
  return (
    <motion.div
      className={cn(className)}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: gap, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={cn(className)}
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.4, ease: EASE },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
