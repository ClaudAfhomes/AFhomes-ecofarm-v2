import { motion } from "motion/react";
import { cn } from "../../lib/cn";
import { EASE, VIEWPORT } from "../../lib/motion";

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  once?: boolean;
  className?: string;
}

/** Fade-up reveal when the element scrolls into view. */
export function Reveal({ children, delay = 0, y = 28, once = true, className }: RevealProps) {
  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ ...VIEWPORT, once }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}