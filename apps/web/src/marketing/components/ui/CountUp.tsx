import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { cn } from "../../lib/cn";
import { EASE } from "../../lib/motion";

interface CountUpProps {
  value: number;
  /** Appended literal, e.g. "+" for "10+". */
  suffix?: string;
  /** Zero-pad the integer part, e.g. "03". */
  minDigits?: number;
  /** Animation length in seconds. */
  duration?: number;
  className?: string;
}

/**
 * Quiet number count-up that starts when the statistic scrolls into view.
 * Renders the final value directly when reduced motion is preferred.
 */
export function CountUp({
  value,
  suffix = "",
  minDigits = 1,
  duration = 0.9,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (!inView) return;
    if (reducedMotion) {
      // Reduced motion: jump straight to the final value (source behavior).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(String(value).padStart(minDigits, "0"));
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: EASE,
      onUpdate: (latest) => setDisplay(String(Math.round(latest)).padStart(minDigits, "0")),
    });
    return () => controls.stop();
  }, [inView, reducedMotion, value, duration, minDigits]);

  return (
    <span ref={ref} className={cn(className)}>
      {display}
      {suffix}
    </span>
  );
}
