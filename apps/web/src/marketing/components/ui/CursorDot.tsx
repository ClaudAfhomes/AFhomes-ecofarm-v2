import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";

/**
 * Subtle desktop-only cursor accent. The native cursor is retained for
 * accessibility; this adds a soft trailing dot plus a "View" tag over
 * [data-cursor="view"] elements. Disabled on touch devices and for users who
 * prefer reduced motion.
 */
export function CursorDot() {
  const [enabled, setEnabled] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const springX = useSpring(x, { stiffness: 420, damping: 34, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 420, damping: 34, mass: 0.6 });

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => setEnabled(finePointer.matches && !reducedMotion.matches);
    update();
    finePointer.addEventListener("change", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      finePointer.removeEventListener("change", update);
      reducedMotion.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onPointerMove = (event: PointerEvent) => {
      x.set(event.clientX);
      y.set(event.clientY);

      const target = event.target as Element | null;
      const hovered = target?.closest<HTMLElement>("[data-cursor]");
      setLabel(hovered?.dataset.cursor ?? null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [enabled, x, y]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-hidden="true">
      <motion.div
        className="fixed top-0 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-coral-500/80"
        style={{ x: springX, y: springY }}
      />
      {label && (
        <motion.div
          className="label-caps fixed top-0 left-0 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cream-100/40 bg-navy-950/80 text-cream-100 backdrop-blur-sm"
          style={{ x: springX, y: springY }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
        >
          {label}
        </motion.div>
      )}
    </div>
  );
}