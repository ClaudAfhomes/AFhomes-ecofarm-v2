import { motion } from "motion/react";
import { cn } from "../../lib/cn";
import { EASE } from "../../lib/motion";

interface AnimatedTextProps {
  text: string;
  className?: string;
  delay?: number;
}

/** Word-by-word reveal for above-the-fold headlines; plays on mount. */
export function AnimatedText({ text, className, delay = 0 }: AnimatedTextProps) {
  const words = text.split(" ");

  return (
    <span className={cn("inline", className)}>
      {words.map((word, index) => (
        <span className="inline-block overflow-hidden align-bottom" key={`${word}-${index}`}>
          <motion.span
            className="inline-block"
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: 0.8,
              ease: EASE,
              delay: delay + index * 0.045,
            }}
          >
            {word}
          </motion.span>
          {index < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}